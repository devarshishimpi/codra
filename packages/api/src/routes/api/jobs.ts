import { Hono } from "hono";
import type { Context } from "hono";
import {
  defaultRepoConfig,
  findingLabelSchema,
  jobsQuerySchema,
} from "@codraoss/schema";
import { jsonError } from "../../http";
import { parseUnifiedDiff } from "@codraoss/core/diff";
import {
  buildFileReviewPrompts,
  changelogExcerptFromDiff,
  wantsFileContext,
} from "@codraoss/core/prompts/file-review";
import type { ApiEnv } from "../../ports";
import { requirePermission, requireQuota } from "../../middleware/authorize";

// Best-effort: .get()/.terminate() throw if instance is gone/already terminal; both non-fatal.
async function terminateJobWorkflow(
  c: Context<ApiEnv>,
  job: { id: string; workflowInstanceId?: string | null },
) {
  // Goes through platform port; handlers must not touch bindings directly.
  await c.env.deps.platform.terminateJobWorkflow(job);
}

function jobEtag(input: {
  id: string;
  status: string;
  updatedAt: string;
  fileCount: number;
  commentCount: number;
}) {
  return `"job-${input.id}-${input.status}-${input.fileCount}-${input.commentCount}-${new Date(input.updatedAt).getTime()}"`;
}

// Cloudflare's edge rewrites strong ETags to weak (W/"...") when it compresses the response, so the
// client echoes back a weak validator; compare weakly or the 304 path never fires in production.
function etagMatches(header: string | undefined, etag: string) {
  if (!header) return false;
  const bare = etag.replace(/^W\//, "");
  return header
    .split(",")
    .some((candidate) => candidate.trim().replace(/^W\//, "") === bare);
}

function getExecutionContext(c: Context<ApiEnv>) {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

export function createJobsRouter() {
  const app = new Hono<ApiEnv>();

  app.get("/", async (c) => {
    const denied = await requirePermission(c, "jobs.read");
    if (denied) return denied;
    c.env.deps.platform.scheduleBestEffortJobMaintenance(
      getExecutionContext(c),
    );

    const rawQuery = c.req.query();
    const query = jobsQuerySchema.parse(rawQuery);

    const result = await c.env.deps.repositories.jobs.listJobs(
      c.env as any,
      query as any,
    );
    return c.json(result);
  });

  app.get("/:id", async (c) => {
    const denied = await requirePermission(c, "jobs.read", {
      type: "job",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    c.env.deps.platform.scheduleBestEffortJobMaintenance(
      getExecutionContext(c),
    );

    const job = await c.env.deps.repositories.jobs.getJobDetail(
      c.env as any,
      c.req.param("id"),
    );
    if (!job) {
      return jsonError("Job not found.", 404);
    }

    const etag = jobEtag(job);
    const lastModified = new Date(job.updatedAt).toUTCString();
    if (etagMatches(c.req.header("if-none-match"), etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Last-Modified": lastModified,
        },
      });
    }

    const response = c.json({ job });
    response.headers.set("ETag", etag);
    response.headers.set("Last-Modified", lastModified);
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  });

  // diff_input isn't persisted; rebuilt from the job's own base/head commits (not the live PR), via KV cache.
  app.get("/:id/diffs", async (c) => {
    const denied = await requirePermission(c, "jobs.read", {
      type: "job",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const job = await c.env.deps.repositories.jobs.getJobDetail(
      c.env as any,
      c.req.param("id"),
    );
    if (!job) {
      return jsonError("Job not found.", 404);
    }

    const config = job.configSnapshot ?? defaultRepoConfig;
    const github = c.env.deps.gitProvider.createService(job.installationId);

    let rawDiff: string;
    try {
      rawDiff = await c.env.deps.platform.getOrFetchRawDiffForCompletedJob(
        c.env.deps.platform.createReviewRuntime(),
        {
          id: job.id,
          owner: job.owner,
          repo: job.repo,
          baseSha: job.baseSha,
          commitSha: job.commitSha,
        },
        github,
      );
    } catch (error) {
      c.env.deps.platform.logger.warn(
        `Could not reconstruct diff for job ${job.id}`,
        error instanceof Error ? error : new Error(String(error)),
      );
      return c.json({ diffs: {} });
    }

    // Reconstructs the prompt the model actually saw, so it needs the PR description too.
    let prDescription: string | null = null;
    try {
      prDescription =
        (await github.getPullRequest(job.owner, job.repo, job.prNumber)).body ??
        null;
    } catch (error) {
      // Best-effort: missing description degrades fidelity, doesn't fail the view.
      c.env.deps.platform.logger.warn(
        `Could not load the PR body for job ${job.id}; prompts will omit the description`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    // Full PR diff, not just reviewed files, so file count matches GitHub mid-review.
    const diffs: Record<string, string> = {};
    const parsedFiles = parseUnifiedDiff(rawDiff, config.review);
    const changelogExcerpt = changelogExcerptFromDiff(parsedFiles);
    for (const file of parsedFiles) {
      if (file.isDeleted || file.isBinary || !file.path) continue;
      const { userPrompt } = buildFileReviewPrompts({
        file,
        prTitle: job.prTitle,
        prDescription,
        changelogExcerpt,
        config: config.review,
      });
      const hadContext = wantsFileContext(
        file,
        config.review.full_file_context,
      );
      diffs[file.path] = hadContext
        ? `${userPrompt}\n\n[The full file at the reviewed commit was included here at review time; it is omitted from this preview.]`
        : userPrompt;
    }

    const response = c.json({ diffs });
    response.headers.set("Cache-Control", "private, max-age=60");
    return response;
  });

  // inherit=true links retryOfJobId and reuses done file reviews; false reviews everything.
  async function startReplacementJob(
    c: Context<ApiEnv>,
    rawSource: any,
    options: { inherit: boolean },
  ) {
    const jobs = c.env.deps.repositories.jobs;
    const source = jobs.mapJob(rawSource);
    let configSnapshot;
    try {
      const currentConfig = await c.env.deps.config.loadRepoConfig({
        installationId: source.installationId,
        owner: source.owner,
        repo: source.repo,
      });
      configSnapshot = currentConfig?.parsedJson ?? defaultRepoConfig;
    } catch (e) {
      configSnapshot = defaultRepoConfig;
    }

    const job = await jobs.insertJob(c.env as any, {
      installationId: source.installationId,
      owner: source.owner,
      repo: source.repo,
      prNumber: source.prNumber,
      prTitle: source.prTitle,
      prAuthor: source.prAuthor,
      commitSha: source.commitSha,
      baseSha: jobs.bytesToHex(rawSource.base_sha), // base_sha is only in raw row/detail
      trigger: "retry",
      headRef: rawSource.head_ref,
      baseRef: rawSource.base_ref,
      configSnapshot,
      ...(options.inherit ? { retryOfJobId: source.id } : {}),
    });

    await jobs.supersedeOlderJobs(c.env as any, {
      installationId: source.installationId,
      owner: source.owner,
      repo: source.repo,
      prNumber: source.prNumber,
      newJobId: job.id,
    });

    await c.env.deps.platform.enqueueReviewJob({
      jobId: job.id,
      deliveryId: crypto.randomUUID(),
      phase: "prepare",
      requestId: c.get("requestId"),
    });

    return job;
  }

  app.post("/:id/retry", async (c) => {
    const denied = await requirePermission(c, "jobs.retry", {
      type: "job",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const throttled = await requireQuota(c, { action: "jobs.retry" });
    if (throttled) return throttled;
    const jobs = c.env.deps.repositories.jobs;
    const rawSource = await jobs.getJobForProcessing(
      c.env as any,
      c.req.param("id"),
    );
    if (!rawSource) {
      return jsonError("Job not found.", 404);
    }
    const job = await startReplacementJob(c, rawSource, { inherit: true });
    return c.json({ job }, 202);
  });

  // No inheritance; stops the current run first so two workflows can't race.
  app.post("/:id/rerun", async (c) => {
    const denied = await requirePermission(c, "jobs.rerun", {
      type: "job",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const throttled = await requireQuota(c, { action: "jobs.rerun" });
    if (throttled) return throttled;
    const jobs = c.env.deps.repositories.jobs;
    const rawSource = await jobs.getJobForProcessing(
      c.env as any,
      c.req.param("id"),
    );
    if (!rawSource) {
      return jsonError("Job not found.", 404);
    }
    const source = jobs.mapJob(rawSource);
    if (source.status === "queued" || source.status === "running") {
      await terminateJobWorkflow(c, source);
    }
    const job = await startReplacementJob(c, rawSource, { inherit: false });
    return c.json({ job }, 202);
  });

  app.post("/:id/stop", async (c) => {
    const denied = await requirePermission(c, "jobs.stop", {
      type: "job",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const jobs = c.env.deps.repositories.jobs;
    const id = c.req.param("id");
    const raw = await jobs.getJobForProcessing(c.env as any, id);
    if (!raw) {
      return jsonError("Job not found.", 404);
    }
    const job = jobs.mapJob(raw);
    if (job.status !== "queued" && job.status !== "running") {
      return jsonError("Only a queued or running job can be stopped.", 409);
    }
    await terminateJobWorkflow(c, job);
    await jobs.cancelJob(c.env as any, id);
    const updated = await jobs.getJobForProcessing(c.env as any, id);
    return c.json({ job: updated ? jobs.mapJob(updated) : job }, 200);
  });

  // "wrong" suppresses this finding repo-wide; "right" is measurement only.
  app.put("/:id/findings/:fingerprint/label", async (c) => {
    const denied = await requirePermission(c, "jobs.label", {
      type: "job",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const jobId = c.req.param("id");
    const fingerprint = c.req.param("fingerprint");

    const parsed = findingLabelSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return jsonError('Body must be {"label":"right"|"wrong"}.', 400);

    const target =
      await c.env.deps.repositories.fileReviews.getFindingLabelTarget(
        c.env as any,
        jobId,
        fingerprint,
      );
    if (!target) return jsonError("Finding not found on this job.", 404);

    await c.env.deps.repositories.commentFeedback.upsertDashboardFeedback(
      c.env as any,
      {
        repositoryId: target.repository_id,
        prNumber: target.pr_number,
        fingerprint,
        anchorHash: target.anchor_hash,
        // Keeps rejection valid even if the model rewords the title.
        fingerprintV2: target.fingerprint_v2,
        jobId,
        labelledBy: c.get("sessionUser")?.providerUserId
          ? Number(c.get("sessionUser")?.providerUserId)
          : null,
        outcome:
          parsed.data.label === "wrong" ? "marked_wrong" : "marked_right",
      },
    );

    return c.json({ label: parsed.data.label }, 200);
  });

  // Scoped to dashboard rows; a real GitHub deletion still stays recorded.
  app.delete("/:id/findings/:fingerprint/label", async (c) => {
    const denied = await requirePermission(c, "jobs.label", {
      type: "job",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const jobId = c.req.param("id");
    const fingerprint = c.req.param("fingerprint");

    const target =
      await c.env.deps.repositories.fileReviews.getFindingLabelTarget(
        c.env as any,
        jobId,
        fingerprint,
      );
    if (!target) return jsonError("Finding not found on this job.", 404);

    await c.env.deps.repositories.commentFeedback.clearDashboardFeedback(
      c.env as any,
      target.repository_id,
      fingerprint,
    );
    return c.body(null, 204);
  });

  app.delete("/:id", async (c) => {
    const denied = await requirePermission(c, "jobs.delete", {
      type: "job",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const jobs = c.env.deps.repositories.jobs;
    const id = c.req.param("id");
    const raw = await jobs.getJobForProcessing(c.env as any, id);
    if (!raw) {
      return jsonError("Job not found.", 404);
    }
    const job = jobs.mapJob(raw);
    if (job.status === "queued" || job.status === "running") {
      await terminateJobWorkflow(c, job);
    }
    await jobs.deleteJob(c.env as any, id);
    return c.body(null, 204);
  });

  return app;
}
