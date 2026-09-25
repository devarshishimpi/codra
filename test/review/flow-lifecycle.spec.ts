import { runReviewJob } from "@server/core/review";
import {
  createTestEnv,
  dbDescribe,
  generateMockDiff,
  sha,
  uniqueRepo,
} from "../helpers";
import { afterAll, vi } from "vitest";
import {
  findExistingJobForHead,
  getJobForProcessing,
  insertJob,
} from "@codraoss/db/jobs";
import { getFileReviewsForJobs } from "@codraoss/db/file-reviews";
import { defaultRepoConfig } from "@codraoss/schema";
import { runWithDb, queryRows } from "@codraoss/db/client";
import { normalizeGitHubWebhook } from "@codraoss/provider-github";
import {
  makeRunAndDrain,
  REVIEW_FLOW_TIMEOUT_MS,
} from "../mocks/review-harness";

const { getOtherRunningJobsCountMock } = vi.hoisted(() => ({
  getOtherRunningJobsCountMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("@codraoss/db/jobs", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, getOtherRunningJobsCount: getOtherRunningJobsCountMock };
});

// global_settings is a singleton; pin the schema default to avoid racing suites that write it.
const { getReviewSettingsMock } = vi.hoisted(() => ({
  getReviewSettingsMock: vi.fn(),
}));

vi.mock("@codraoss/db/app-settings", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { reviewSettingsSchema } = await import("@codraoss/schema");
  getReviewSettingsMock.mockResolvedValue(reviewSettingsSchema.parse({}));
  return { ...mod, getReviewSettings: getReviewSettingsMock };
});

vi.mock("@codraoss/provider-github", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { makeGitHubServiceMock } = await import("../mocks/services");
  return { ...mod, GitHubService: makeGitHubServiceMock() };
});

vi.mock("@codraoss/models", async () => {
  const {
    makeModelServiceMock,
    isRetryableModelErrorMock,
    nextChainIndexOfMock,
  } = await import("../mocks/services");
  return {
    ModelRunner: makeModelServiceMock(),
    isRetryableModelError: isRetryableModelErrorMock,
    nextChainIndexOf: nextChainIndexOfMock,
  };
});

// Mirrors the maintenance sweep's predicate directly; the sweep query's LIMIT can miss a fresh job on a shared DB.
async function needsCheckRunCompletion(
  env: Parameters<typeof queryRows>[0],
  jobId: string,
) {
  const rows = await queryRows<{ id: string }>(
    env,
    `SELECT id FROM jobs
      WHERE id = $1::uuid
        AND status IN ('done', 'failed', 'superseded', 'cancelled')
        AND check_run_id IS NOT NULL
        AND check_run_completed_at IS NULL`,
    [jobId],
  );
  return rows.length > 0;
}

dbDescribe("Review flow: lifecycle and finalize", () => {
  // Tripwire: catches a barrel-import refactor that would silently break this mock.
  afterAll(() => {
    expect(getOtherRunningJobsCountMock).toHaveBeenCalled();
    expect(getReviewSettingsMock).toHaveBeenCalled();
  });

  const env = createTestEnv();
  const runAndDrain = makeRunAndDrain(env);

  it(
    "completes a full review from pending job to finished",
    async () => {
      const repo = uniqueRepo("full");
      const headSha = sha("a");
      const baseSha = sha("b");

      await runAndDrain({
        deliveryId: "delivery-123",
        ...(normalizeGitHubWebhook("pull_request", {
          action: "opened",
          installation: { id: 123 },
          repository: { owner: { login: "test-owner" }, name: repo },
          pull_request: {
            number: 1,
            head: { sha: headSha, ref: "feature" },
            base: { sha: baseSha, ref: "main" },
            title: "Test PR",
            user: { login: "author" },
            draft: false,
          },
        }) as any),
      });

      const finalJob = await findExistingJobForHead(env, {
        owner: "test-owner",
        repo,
        prNumber: 1,
        commitSha: headSha,
        trigger: "auto",
      });
      expect(finalJob?.status).toBe("done");
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  it(
    "stops processing if the job is superseded mid-way",
    async () => {
      const { GitHubService } = await import("@codraoss/provider-github");
      const repo = uniqueRepo("supersede");
      const headSha = sha("c");
      const baseSha = sha("d");

      const getDiffSpy = vi.spyOn(
        GitHubService.prototype,
        "getPullRequestDiff",
      );

      getDiffSpy.mockImplementationOnce(async () => {
        const { getDb } = await import("@codraoss/db/client");
        const sql = getDb(env);
        await sql.query(
          `
              UPDATE jobs j
              SET status = 'superseded'
              FROM repositories r
              WHERE j.repository_id = r.id
                AND r.owner = $1
                AND r.repo = $2
                AND j.pr_number = $3
            `,
          ["test-owner", repo, 2],
        );
        return generateMockDiff([{ path: "test.ts", content: "a" }]);
      });

      await runAndDrain({
        deliveryId: "delivery-456",
        ...normalizeGitHubWebhook("pull_request", {
          action: "opened",
          installation: { id: 123 },
          repository: { owner: { login: "test-owner" }, name: repo },
          pull_request: {
            number: 2,
            head: { sha: headSha, ref: "feature" },
            base: { sha: baseSha, ref: "main" },
            title: "Supersede Test",
            user: { login: "author" },
            draft: false,
          },
        }),
      } as any);

      const finalJob = await findExistingJobForHead(env, {
        owner: "test-owner",
        repo,
        prNumber: 2,
        commitSha: headSha,
        trigger: "auto",
      });
      expect(finalJob?.status).toBe("superseded");
      expect(finalJob?.verdict).toBeNull();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  it(
    "throttles a new (queued) job at the concurrency limit but never a running continuation",
    async () => {
      const jobsMod = await import("@codraoss/db/jobs");
      const repo = uniqueRepo("admission");
      const baseSha = sha("0");
      const base = {
        installationId: "123",
        owner: "test-owner",
        repo,
        prAuthor: "author",
        baseSha,
        trigger: "auto" as const,
        headRef: "feature",
        baseRef: "main",
        configSnapshot: defaultRepoConfig,
      };

      const queued = await insertJob(env, {
        ...base,
        prNumber: 30,
        prTitle: "Admission Queued",
        commitSha: sha("c"),
      });
      const running = await insertJob(env, {
        ...base,
        prNumber: 31,
        prTitle: "Admission Running",
        commitSha: sha("d"),
      });
      // Far over limit; restored after so the mock doesn't leak.
      vi.mocked(jobsMod.getOtherRunningJobsCount).mockResolvedValue(99);
      try {
        // Queued job is gated at the limit -> retry.
        await runWithDb(env, async () => {
          const res = await runReviewJob(env, {
            jobId: queued.id,
            deliveryId: "delivery-adm-queued",
            phase: "prepare",
          });
          expect(res.action).toBe("retry");
        });

        // Running job must not be re-gated: that's the starvation bug.
        await runWithDb(env, async () => {
          await queryRows(
            env,
            `UPDATE jobs SET status = 'running' WHERE id = $1`,
            [running.id],
          );
          const res = await runReviewJob(env, {
            jobId: running.id,
            deliveryId: "delivery-adm-running",
            phase: "review",
          });
          expect(res.action).not.toBe("retry");
        });
      } finally {
        vi.mocked(jobsMod.getOtherRunningJobsCount).mockResolvedValue(0);
      }
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  it("bulk-marks missing files failed in a single pass without clobbering existing rows", async () => {
    const { bulkMarkFilesFailed } = await import("@codraoss/db/file-reviews");
    const job = await insertJob(env, {
      installationId: "123",
      owner: "test-owner",
      repo: uniqueRepo("bulk-failed"),
      prNumber: 40,
      prTitle: "Bulk failed",
      prAuthor: "author",
      commitSha: sha("e"),
      baseSha: sha("0"),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
      configSnapshot: defaultRepoConfig,
    });

    await bulkMarkFilesFailed(
      env,
      job.id,
      [
        { filePath: "src/a.ts", diffLineCount: 10 },
        { filePath: "src/b.ts", diffLineCount: 20 },
      ],
      { modelUsed: "gemini-3.1-flash-lite", errorMessage: "infra limit" },
    );

    // Second call must not duplicate or overwrite an existing path.
    await bulkMarkFilesFailed(
      env,
      job.id,
      [
        { filePath: "src/a.ts", diffLineCount: 10 },
        { filePath: "src/c.ts", diffLineCount: 5 },
      ],
      { modelUsed: "other-model", errorMessage: "second call" },
    );

    const reviews = await getFileReviewsForJobs(env, [job.id]);
    expect(reviews).toHaveLength(3);
    expect(reviews.every((r) => r.file_status === "failed")).toBe(true);
    // a.ts keeps first values, not clobbered.
    expect(reviews.find((r) => r.file_path === "src/a.ts")?.error_msg).toBe(
      "infra limit",
    );
    expect(reviews.find((r) => r.file_path === "src/c.ts")?.error_msg).toBe(
      "second call",
    );
  });

  it(
    "completes the job with the review recorded even if post-review check-run/label updates fail",
    async () => {
      // Regression: check-run/label failures mid-finalize must not strand the job as 'failed'.
      const { GitHubService } = await import("@codraoss/provider-github");
      const checkRunSpy = vi
        .spyOn(GitHubService.prototype, "updateCheckRun" as any)
        .mockRejectedValue(
          new Error("Too many subrequests by single Worker invocation"),
        );

      const job = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo: uniqueRepo("besteffort"),
        prNumber: 41,
        prTitle: "Best effort",
        prAuthor: "author",
        commitSha: sha("f"),
        baseSha: sha("0"),
        trigger: "auto",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: defaultRepoConfig,
      });

      await runAndDrain({ jobId: job.id, deliveryId: "delivery-besteffort" });

      const final = await getJobForProcessing(env, job.id);
      expect(final?.status).toBe("done");
      expect(final?.review_id).not.toBeNull();
      // Update failed; stays pending for the maintenance sweep.
      expect(final?.check_run_completed_at).toBeNull();
      expect(await needsCheckRunCompletion(env, job.id)).toBe(true);
      checkRunSpy.mockRestore();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );
});
