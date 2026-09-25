import { runReviewJob } from "@server/core/review";
import {
  createTestEnv,
  dbDescribe,
  sha,
  uniqueName,
  uniqueRepo,
} from "../helpers";
import { afterAll, expect, vi } from "vitest";
import { findExistingJobForHead, getJobForProcessing } from "@codraoss/db/jobs";
import { getFileReviewsForJobs } from "@codraoss/db/file-reviews";
import { runWithDb, queryRows } from "@codraoss/db/client";

const { getOtherRunningJobsCountMock } = vi.hoisted(() => ({
  getOtherRunningJobsCountMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("@codraoss/db/jobs", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, getOtherRunningJobsCount: getOtherRunningJobsCountMock };
});

// global_settings is a singleton; pin schema default to avoid parallel-suite races.
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

// Async model mock: pending on first poll, done on second; reviewFile must not be called.
const pollCalls = { count: 0 };
const reviewFileSpy = vi.fn();
vi.mock("@codraoss/models", async () => {
  class MockModelService {
    async submitReviewBatch() {
      return { requestId: "req-async-1", model: "@cf/moonshotai/kimi-k2.6" };
    }
    async pollReviewBatch() {
      pollCalls.count += 1;
      if (pollCalls.count < 2) return { status: "pending" as const };
      return {
        status: "done" as const,
        response: {
          modelUsed: "@cf/moonshotai/kimi-k2.6",
          provider: "Cloudflare",
          inputTokens: 11,
          outputTokens: 7,
          rawText: '{"findings":[]}',
          userPrompt: "",
          parsed: {
            comments: [],
            verdict: "approve" as const,
            fileSummary: "ok",
            overallCorrectness: "patch is correct",
            confidenceScore: 0.9,
          },
        },
      };
    }
    async reviewFile() {
      reviewFileSpy();
      throw new Error("sync reviewFile should not be called on the async path");
    }
    async generateSummary() {
      return {
        modelUsed: "m",
        provider: "p",
        rawText: '{"summary":"s"}',
        inputTokens: 1,
        outputTokens: 1,
      };
    }
  }
  const { nextChainIndexOfMock } = await import("../mocks/services");
  return {
    ModelRunner: MockModelService,
    isRetryableModelError: (e: unknown) =>
      Boolean(e && typeof e === "object" && (e as any).retryable === true),
    nextChainIndexOf: nextChainIndexOfMock,
  };
});

dbDescribe("Async batch review flow", () => {
  // Tripwire: catches runReviewJob silently dropping the getOtherRunningJobsCount import.
  afterAll(() => {
    expect(getOtherRunningJobsCountMock).toHaveBeenCalled();
    expect(getReviewSettingsMock).toHaveBeenCalled();
  });

  const env = createTestEnv();

  // Backdates last_queue_message_at so claimJobLease can claim without waiting out the delay.
  async function simulateScheduledDelayElapsed(jobId: string) {
    await queryRows(
      env,
      `UPDATE jobs SET last_queue_message_at = now() - interval '1 second' WHERE id = $1`,
      [jobId],
    );
  }

  it("submits to the async queue, stays pending across polls, then completes and finalizes", async () => {
    pollCalls.count = 0;
    const repo = uniqueRepo("async");
    const headSha = sha("c");

    await runWithDb(env, async () => {
      const rawPayload = {
        action: "opened",
        installation: { id: 123 },
        repository: { owner: { login: "test-owner" }, name: repo },
        pull_request: {
          number: 1,
          head: { sha: headSha, ref: "feature" },
          base: { sha: sha("d"), ref: "main" },
          title: "Test PR",
          user: { login: "author" },
          draft: false,
        },
      };
      const { normalizeGitHubWebhook } =
        await import("@codraoss/provider-github");
      const normalized = normalizeGitHubWebhook("pull_request", rawPayload);
      const prep = await runReviewJob(env, {
        deliveryId: uniqueName("delivery-async"),
        eventName: normalized!.eventName,
        payload: normalized!.payload as any,
      });
      expect(prep).toMatchObject({ action: "next_phase", phase: "review" });

      const job = await findExistingJobForHead(env, {
        owner: "test-owner",
        repo,
        prNumber: 1,
        commitSha: headSha,
        trigger: "auto",
      });
      const jobId = job!.id;

      // Prepare's enqueue also delay-gates this step, hence the same simulated elapse.
      await simulateScheduledDelayElapsed(jobId);
      const submitResult = await runReviewJob(env, {
        jobId,
        phase: "review",
      } as any);
      expect(submitResult).toMatchObject({
        action: "next_phase",
        phase: "review",
      });
      let reviews = await getFileReviewsForJobs(env, [jobId]);
      expect(reviews).toHaveLength(1);
      expect(reviews[0].file_status).toBe("pending");
      expect(reviews[0].async_request_id).toBe("req-async-1");

      await simulateScheduledDelayElapsed(jobId);
      const pollPending = await runReviewJob(env, {
        jobId,
        phase: "review",
      } as any);
      expect(pollPending).toMatchObject({
        action: "next_phase",
        phase: "review",
      });
      reviews = await getFileReviewsForJobs(env, [jobId]);
      expect(reviews[0].file_status).toBe("pending");

      await simulateScheduledDelayElapsed(jobId);
      const pollDone = await runReviewJob(env, {
        jobId,
        phase: "review",
      } as any);
      expect(pollDone).toMatchObject({
        action: "next_phase",
        phase: "finalize",
      });
      reviews = await getFileReviewsForJobs(env, [jobId]);
      expect(reviews[0].file_status).toBe("done");
      expect(reviews[0].async_request_id).toBeNull();
      expect(reviews[0].model_used).toBe("@cf/moonshotai/kimi-k2.6");

      expect(reviewFileSpy).not.toHaveBeenCalled();
      expect(pollCalls.count).toBeGreaterThanOrEqual(2);

      expect(await getJobForProcessing(env, jobId)).toBeTruthy();
    });
  }, 60_000);
});
