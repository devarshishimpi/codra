import { Hono } from "hono";
import type { Context } from "hono";
import {
  isFeedbackGitHubWebhookEvent,
  type FeedbackWebhookPayload,
  type GitHubReviewCommentPayload,
  type GitHubWebhookPayload,
} from "@codraoss/schema/github";
import type { ApiEnv } from "../ports";
import { jsonError } from "../http";

// Matches via the invisible `codra-fp` marker GitHub echoes back verbatim; comments without one are ignored. Best-effort: failures here must never surface as a webhook error GitHub retries.
async function handleFeedbackEvent(
  c: Context<ApiEnv>,
  input: {
    eventName: string;
    payload: FeedbackWebhookPayload;
    repositoryId: number | null;
  },
): Promise<number> {
  const { eventName, payload, repositoryId } = input;
  // The repository has to be one we know; the FK would reject anything else.
  if (repositoryId === null) return 0;

  const botLogin = (c.env.BOT_USERNAME ?? "").toLowerCase();
  // GitHub fires these events for human threads too; without this filter we'd suppress our own findings based on humans deleting each other's comments.
  const isOurs = (comment: GitHubReviewCommentPayload) =>
    Boolean(botLogin) &&
    (comment.user?.login ?? "").toLowerCase().startsWith(botLogin);

  const prNumber = payload.pull_request?.number ?? null;
  const entries: any[] = [];
  const reopened: number[] = [];

  const add = (comment: GitHubReviewCommentPayload, outcome: any) => {
    if (!isOurs(comment) || !comment?.body) return;

    // We need a port for parsing finding markers since it used to come from @server/services/formatter
    // We'll use a local minimal parser or expect the webhook port to provide it
    const markerMatch = (comment.body || "").match(/<!-- codra-fp: (.*?) -->/);
    if (!markerMatch) return;

    let fingerprint = markerMatch[1];
    let anchorHash = "";
    let fingerprintV2 = null;
    try {
      const parts = JSON.parse(fingerprint);
      if (Array.isArray(parts) && parts.length >= 2) {
        fingerprintV2 = parts[0];
        fingerprint = parts[1];
        if (parts.length >= 3) anchorHash = parts[2];
      }
    } catch {
      // old format
    }

    entries.push({
      repositoryId,
      prNumber,
      fingerprint,
      anchorHash,
      fingerprintV2,
      githubCommentId: comment.id,
      outcome,
    });
  };

  if (eventName === "pull_request_review_comment") {
    const { action, comment } = payload as Extract<
      FeedbackWebhookPayload,
      { comment: unknown }
    >;
    // 'created' is how we learn the real GitHub comment id for free, with no extra request; 'deleted' is the only negative signal we act on.
    if (action === "created") add(comment, "posted");
    else if (action === "deleted") add(comment, "deleted");
  } else if (eventName === "pull_request_review_thread") {
    const { action, thread } = payload as Extract<
      FeedbackWebhookPayload,
      { thread: unknown }
    >;
    for (const comment of thread?.comments ?? []) {
      if (action === "resolved") {
        add(comment, "resolved");
      } else if (action === "unresolved") {
        add(comment, "unresolved");
        if (isOurs(comment)) reopened.push(comment.id);
      }
    }
  }

  if (entries.length === 0) return 0;

  try {
    const feedbackRepo = c.env.deps.repositories.commentFeedback;
    // Reopening a thread must retract the earlier 'resolved' row, or the finding stays recorded as accepted forever.
    if (reopened.length > 0)
      await feedbackRepo.clearResolvedFeedback(
        c.env as any,
        repositoryId,
        reopened,
      );
    return await feedbackRepo.recordCommentFeedback(c.env as any, entries);
  } catch (error) {
    c.env.deps.platform.logger.warn("Could not record comment feedback", {
      eventName,
      repositoryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

export async function handleGitHubWebhook(c: Context<ApiEnv>) {
  const eventName = c.req.header("x-github-event");
  const deliveryId = c.req.header("x-github-delivery");
  const signature = c.req.header("x-hub-signature-256");
  const rawBody = await c.req.text();

  if (!eventName || !deliveryId) {
    return jsonError("Missing GitHub webhook headers.", 400);
  }

  const verified = await c.env.deps.webhook.verifySignature(
    signature ?? null,
    rawBody,
  );
  if (!verified) {
    return jsonError("Invalid webhook signature.", 401);
  }

  let payload: GitHubWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubWebhookPayload;
  } catch {
    return jsonError("Invalid webhook JSON payload.", 400);
  }

  // Feedback deliveries carry the whole PR object plus diff hunks per comment; skip storing the payload (row is still written, so dedup still works).
  const isFeedbackEvent = isFeedbackGitHubWebhookEvent(eventName);

  const delivery =
    await c.env.deps.repositories.webhookDeliveries.recordWebhookDelivery(
      c.env as any,
      {
        deliveryId,
        eventName,
        owner:
          "repository" in payload
            ? (payload as any).repository.owner.login
            : null,
        repo: "repository" in payload ? (payload as any).repository.name : null,
        payload: isFeedbackEvent ? null : payload,
      },
    );

  if (!delivery.inserted) {
    return c.json({ ok: true, duplicate: true }, 202);
  }

  const installationId = String((payload as any).installation?.id ?? "");
  if (!installationId || !("repository" in payload) || !payload.repository) {
    return c.json({ ok: true, ignored: true }, 202);
  }

  // Handled inline before loadRepoConfig: recording feedback needs no repo config, queue message, or Workflow, so skip that KV/DB cost entirely.
  if (isFeedbackEvent) {
    const recorded = await handleFeedbackEvent(c, {
      eventName,
      payload: payload as unknown as FeedbackWebhookPayload,
      repositoryId: delivery.repositoryId,
    });
    return c.json({ ok: true, feedback: true, recorded }, 202);
  }

  const normalized = c.env.deps.webhook.normalizePayload(eventName, payload);
  if (!normalized) {
    return c.json({ ok: true, ignored: true, eventName }, 202);
  }

  const repoConfig = await c.env.deps.config.loadRepoConfig({
    installationId,
    owner: (payload as any).repository.owner.login,
    repo: (payload as any).repository.name,
  });

  if (repoConfig.enabled === false) {
    return c.json(
      { ok: true, ignored: true, reason: "repository_disabled" },
      202,
    );
  }

  const extracted = c.env.deps.webhook.extractReviewRequest({
    eventName: normalized.eventName,
    payload: normalized.payload,
    botUsername: c.env.BOT_USERNAME,
    config: repoConfig.parsedJson,
  });

  if (extracted?.commitSha && extracted.baseSha) {
    const jobsRepo = c.env.deps.repositories.jobs;
    const existingJob = await jobsRepo.findExistingJobForHead(c.env as any, {
      owner: extracted.owner,
      repo: extracted.repo,
      prNumber: extracted.prNumber,
      commitSha: extracted.commitSha,
      trigger: extracted.trigger,
    });

    if (existingJob) {
      return c.json(
        {
          ok: true,
          duplicate: true,
          message: existingJob.status === "queued" ? "queued" : "duplicate",
          job: existingJob,
        },
        202,
      );
    }

    const throttled = await c.env.deps.checkQuota?.({
      action: "reviews.enqueue",
      subject: {
        installationId: extracted.installationId,
        owner: extracted.owner,
        repo: extracted.repo,
      },
    });
    if (throttled && !throttled.allowed) {
      // Deliberately 202, not 429: GitHub redelivers failed webhooks, so 4xx causes retry storms.
      return c.json({ ok: true, ignored: true, reason: "quota_exceeded" }, 202);
    }

    const job = await jobsRepo.insertJob(c.env as any, {
      installationId: extracted.installationId,
      owner: extracted.owner,
      repo: extracted.repo,
      prNumber: extracted.prNumber,
      prTitle: extracted.prTitle,
      prAuthor: extracted.prAuthor,
      commitSha: extracted.commitSha,
      baseSha: extracted.baseSha,
      trigger: extracted.trigger,
      headRef: extracted.headRef,
      baseRef: extracted.baseRef,
      configSnapshot: repoConfig.parsedJson,
    });

    await jobsRepo.supersedeOlderJobs(c.env as any, {
      installationId: extracted.installationId,
      owner: extracted.owner,
      repo: extracted.repo,
      prNumber: extracted.prNumber,
      newJobId: job.id,
    });

    await c.env.deps.platform.enqueueReviewJob({
      jobId: job.id,
      deliveryId,
      phase: "prepare",
      requestId: c.get("requestId"),
    });

    return c.json({ ok: true, message: "queued", job }, 202);
  }

  // Events without a concrete job (e.g. PR close cleanup, mention lookups) still get handled by the worker.
  await c.env.deps.platform.enqueueReviewJob({
    deliveryId,
    eventName,
    requestId: c.get("requestId"),
  } as any);

  return c.json({ ok: true, message: "queued" }, 202);
}

export function createWebhookRouter() {
  const app = new Hono<ApiEnv>();

  app.post("/", handleGitHubWebhook);

  return app;
}
