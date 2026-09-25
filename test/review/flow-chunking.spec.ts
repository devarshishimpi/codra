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
  getJobForProcessing,
  insertJob,
  updateJobFileCount,
  updateJobStep,
} from "@codraoss/db/jobs";
import {
  getFileReviewsForJobs,
  upsertFileReview,
} from "@codraoss/db/file-reviews";
import { defaultRepoConfig } from "@codraoss/schema";
import { runWithDb } from "@codraoss/db/client";
import { REVIEW_FLOW_TIMEOUT_MS } from "../mocks/review-harness";

const { getOtherRunningJobsCountMock } = vi.hoisted(() => ({
  getOtherRunningJobsCountMock: vi.fn().mockResolvedValue(0),
}));

vi.mock("@codraoss/db/jobs", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, getOtherRunningJobsCount: getOtherRunningJobsCountMock };
});

// `global_settings` is a singleton, so reading it races the suites that write it once files run in
// parallel. This suite only needs some fixed concurrency, so pin the schema default.
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

dbDescribe("Review flow: chunking, partial reviews and re-posting", () => {
  // Tripwire: if a refactor rewires runReviewJob past the @codraoss/db/jobs barrel, the mock stops
  // applying and every test here still passes while asserting nothing.
  afterAll(() => {
    expect(getOtherRunningJobsCountMock).toHaveBeenCalled();
    expect(getReviewSettingsMock).toHaveBeenCalled();
  });

  const env = createTestEnv();

  // Batching opted out: this measures per-file concurrency. Batched equivalent in batch-flow.spec.ts.
  const unbatchedConfig = {
    ...defaultRepoConfig,
    review: { ...defaultRepoConfig.review, batch_small_files: false },
  };

  it(
    "reviews files in a chunk concurrently",
    async () => {
      const { GitHubService } = await import("@codraoss/provider-github");
      const { ModelRunner } = await import("@codraoss/models");
      const repo = uniqueRepo("concurrent");
      const headSha = sha("8");
      const baseSha = sha("9");
      const getDiffSpy = vi
        .spyOn(GitHubService.prototype, "getPullRequestDiff")
        .mockResolvedValue(
          generateMockDiff([
            { path: "src/one.ts", content: "console.log(1);" },
            { path: "src/two.ts", content: "console.log(2);" },
          ]),
        );
      let active = 0;
      let maxActive = 0;
      const reviewSpy = vi
        .spyOn(ModelRunner.prototype as any, "reviewFile")
        .mockImplementation(async (params: any) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 25));
          active -= 1;
          return {
            parsed: {
              comments: [],
              verdict: "approve",
              fileSummary: `Reviewed ${params.file.path}`,
              overallCorrectness: "no issues",
              confidenceScore: 0.9,
            },
            modelUsed: "test-model",
            provider: "test-provider",
            inputTokens: 10,
            outputTokens: 5,
            rawText: "{}",
            userPrompt: "",
          };
        });

      const job = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 6,
        prTitle: "Concurrent Test",
        prAuthor: "author",
        commitSha: headSha,
        baseSha,
        trigger: "auto",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: unbatchedConfig,
      });
      await updateJobFileCount(env, job.id, 2);
      await updateJobStep(env, job.id, "Preparation", { status: "done" });

      await runWithDb(env, async () => {
        (env.REVIEW_QUEUE as any).sent.length = 0;
        const result = await runReviewJob(env, {
          jobId: job.id,
          deliveryId: "delivery-concurrent",
          phase: "review",
        });

        // Finalize yields long enough to hibernate into a fresh instance, so the delay is that yield.
        expect(result).toEqual({
          action: "next_phase",
          phase: "finalize",
          delaySeconds: expect.any(Number),
          jobId: expect.any(String),
          freshInstance: true,
        });
        expect(
          result.action === "next_phase" && result.delaySeconds,
        ).toBeGreaterThan(0);
        expect(maxActive).toBe(2);
        expect((env.REVIEW_QUEUE as any).sent).toHaveLength(0);
      });

      const reviews = await getFileReviewsForJobs(env, [job.id]);
      expect(
        reviews.filter((review) => review.file_status === "done"),
      ).toHaveLength(2);

      reviewSpy.mockRestore();
      getDiffSpy.mockRestore();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  it(
    "marks completed jobs with skipped files as partial reviews",
    async () => {
      const { GitHubService } = await import("@codraoss/provider-github");
      const { ModelRunner } = await import("@codraoss/models");
      const repo = uniqueRepo("partial");
      const headSha = sha("e");
      const baseSha = sha("f");
      const getDiffSpy = vi
        .spyOn(GitHubService.prototype, "getPullRequestDiff")
        .mockResolvedValue(
          generateMockDiff([
            { path: "src/app.ts", content: "console.log(1);" },
            { path: "src/failed.ts", content: "console.log(2);" },
          ]),
        );

      const job = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 7,
        prTitle: "Partial Test",
        prAuthor: "author",
        commitSha: headSha,
        baseSha,
        trigger: "auto",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: defaultRepoConfig,
      });
      const summarySpy = vi.spyOn(
        ModelRunner.prototype as any,
        "generateSummary",
      );
      await updateJobFileCount(env, job.id, 2);
      await updateJobStep(env, job.id, "Preparation", { status: "done" });
      await updateJobStep(env, job.id, "Reviewing Files", { status: "done" });
      await upsertFileReview(env, job.id, {
        filePath: "src/app.ts",
        fileStatus: "done",
        modelUsed: "test-model",
        modelProvider: "test-provider",
        diffLineCount: 1,
        diffInput: "diff",
        rawAiOutput: "{}",
        parsedComments: [],
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
        verdict: "approve",
        fileSummary: "ok",
        errorMessage: null,
      });
      await upsertFileReview(env, job.id, {
        filePath: "src/failed.ts",
        fileStatus: "failed",
        modelUsed: "gemini-3.1-pro-preview",
        modelProvider: "google",
        diffLineCount: 1,
        diffInput: "",
        rawAiOutput: null,
        parsedComments: [],
        inputTokens: null,
        outputTokens: null,
        durationMs: 1,
        verdict: null,
        fileSummary: null,
        errorMessage: "Review skipped after 3 repeated model provider outages.",
      });

      await runWithDb(env, async () => {
        (env.REVIEW_QUEUE as any).sent.length = 0;
        const result = await runReviewJob(env, {
          jobId: job.id,
          deliveryId: "delivery-partial",
          phase: "finalize",
        });
        expect(result).toEqual({ action: "ack" });
      });

      const finalJob = await getJobForProcessing(env, job.id);
      expect(finalJob?.status).toBe("done");
      expect(finalJob?.error_msg).toContain("Partial review: 1 of 2 files");
      const steps =
        typeof finalJob?.steps === "string"
          ? JSON.parse(finalJob.steps)
          : finalJob?.steps;
      expect(
        steps?.find((step: { name: string }) => step.name === "Completing")
          ?.status,
      ).toBe("done");

      // The dashboard renders a step's duration from startedAt->finishedAt and shows a dash without
      // both. `Verifying Findings` was written once, with only a terminal status, so the slowest part of
      // finalize reported no duration at all.
      const verifyStep = steps?.find(
        (step: { name: string }) => step.name === "Verifying Findings",
      );
      expect(verifyStep).toBeDefined();
      expect(verifyStep.startedAt).toBeTruthy();
      expect(verifyStep.finishedAt).toBeTruthy();
      expect(new Date(verifyStep.finishedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(verifyStep.startedAt).getTime(),
      );
      expect(finalJob?.summary_markdown).toMatch(/^### Codra Review/);
      expect(finalJob?.summary_model).toBeNull();
      expect(summarySpy).not.toHaveBeenCalled();
      summarySpy.mockRestore();
      getDiffSpy.mockRestore();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  it(
    "reuses an already-posted review instead of double-posting when finalize re-runs past the posting stage",
    async () => {
      const { GitHubService } = await import("@codraoss/provider-github");
      const repo = uniqueRepo("doublepost");
      const getDiffSpy = vi
        .spyOn(GitHubService.prototype, "getPullRequestDiff")
        .mockResolvedValue(
          generateMockDiff([
            { path: "src/app.ts", content: "console.log(1);" },
          ]),
        );
      // A prior attempt posted review 999 but died before recording it; finalize must reuse it.
      const findSpy = vi
        .spyOn(GitHubService.prototype, "findBotReviewForCommit")
        .mockResolvedValue({ id: 999 });
      const createSpy = vi.spyOn(GitHubService.prototype, "createReview");

      const job = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 8,
        prTitle: "Double Post Test",
        prAuthor: "author",
        commitSha: sha("a1"),
        baseSha: sha("b1"),
        trigger: "auto",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: defaultRepoConfig,
      });
      await updateJobFileCount(env, job.id, 1);
      await updateJobStep(env, job.id, "Preparation", { status: "done" });
      await updateJobStep(env, job.id, "Reviewing Files", { status: "done" });
      // A prior finalize attempt reached the posting stage -- this is the marker the guard keys on.
      await updateJobStep(env, job.id, "Completing", { status: "running" });
      await upsertFileReview(env, job.id, {
        filePath: "src/app.ts",
        fileStatus: "done",
        modelUsed: "test-model",
        modelProvider: "test-provider",
        diffLineCount: 1,
        diffInput: "diff",
        rawAiOutput: "{}",
        parsedComments: [],
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
        verdict: "approve",
        fileSummary: "ok",
        errorMessage: null,
      });

      await runWithDb(env, async () => {
        const result = await runReviewJob(env, {
          jobId: job.id,
          deliveryId: "delivery-doublepost",
          phase: "finalize",
        });
        expect(result).toEqual({ action: "ack" });
      });

      expect(findSpy).toHaveBeenCalledTimes(1);
      expect(createSpy).not.toHaveBeenCalled();
      const finalJob = await getJobForProcessing(env, job.id);
      expect(finalJob?.status).toBe("done");
      expect(Number(finalJob?.review_id)).toBe(999);

      findSpy.mockRestore();
      createSpy.mockRestore();
      getDiffSpy.mockRestore();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );
});
