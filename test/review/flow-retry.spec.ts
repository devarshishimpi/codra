import { runReviewJob } from "@server/core/review";
import { createTestEnv, dbDescribe, sha, uniqueRepo } from "../helpers";
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
import { defaultRepoConfig, type ParsedReviewComment } from "@codraoss/schema";
import { runWithDb } from "@codraoss/db/client";
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

dbDescribe("Review flow: retries, inheritance and continuations", () => {
  // Tripwire: if a refactor rewires runReviewJob past the @codraoss/db/jobs barrel, the mock stops
  // applying and every test here still passes while asserting nothing.
  afterAll(() => {
    expect(getOtherRunningJobsCountMock).toHaveBeenCalled();
    expect(getReviewSettingsMock).toHaveBeenCalled();
  });

  const env = createTestEnv();
  const runAndDrain = makeRunAndDrain(env);

  it(
    "processes a pre-created retry job from a queue message",
    async () => {
      const repo = uniqueRepo("retry");
      const sourceHeadSha = sha("1");
      const retryHeadSha = sha("2");
      const baseSha = sha("3");

      const source = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 3,
        prTitle: "Retry Test",
        prAuthor: "author",
        commitSha: sourceHeadSha,
        baseSha,
        trigger: "auto",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: defaultRepoConfig,
      });

      const retry = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 3,
        prTitle: "Retry Test",
        prAuthor: "author",
        commitSha: retryHeadSha,
        baseSha,
        trigger: "retry",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: defaultRepoConfig,
        retryOfJobId: source.id,
      });

      await runAndDrain({
        jobId: retry.id,
        deliveryId: "delivery-retry",
      });

      const finalJob = await getJobForProcessing(env, retry.id);
      expect(finalJob?.status).toBe("done");
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  it(
    "does not inherit parent file reviews from models outside the current retry strategy",
    async () => {
      const { ModelRunner } = await import("@codraoss/models");
      const reviewSpy = vi.spyOn(ModelRunner.prototype, "reviewFile");
      const repo = uniqueRepo("retry-model-filter");
      const sourceHeadSha = sha("8");
      const retryHeadSha = sha("9");
      const baseSha = sha("0");

      const source = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 6,
        prTitle: "Retry Model Filter",
        prAuthor: "author",
        commitSha: sourceHeadSha,
        baseSha,
        trigger: "auto",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: {
          ...defaultRepoConfig,
          model: {
            main: "gemini-3.1-pro-preview",
            fallbacks: ["gemini-2.5-pro", "@cf/zai-org/glm-4.7-flash"],
            size_overrides: [],
          },
        },
      });

      await upsertFileReview(env, source.id, {
        filePath: "src/app.ts",
        fileStatus: "done",
        modelUsed: "@cf/zai-org/glm-4.7-flash",
        modelProvider: "cloudflare",
        diffLineCount: 1,
        diffInput: "old diff",
        rawAiOutput: "{}",
        parsedComments: [],
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
        verdict: "approve",
        fileSummary: "old",
        errorMessage: null,
      });

      const retry = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 6,
        prTitle: "Retry Model Filter",
        prAuthor: "author",
        commitSha: retryHeadSha,
        baseSha,
        trigger: "retry",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: {
          ...defaultRepoConfig,
          model: {
            main: "gemini-3.1-pro-preview",
            fallbacks: ["gemini-2.5-pro"],
            size_overrides: [],
          },
        },
        retryOfJobId: source.id,
      });

      await runAndDrain({
        jobId: retry.id,
        deliveryId: "delivery-retry-model-filter",
      });

      expect(reviewSpy).toHaveBeenCalled();
      const reviews = await getFileReviewsForJobs(env, [retry.id]);
      expect(
        reviews.find((review) => review.file_path === "src/app.ts")?.model_used,
      ).toBe("test-model");
      reviewSpy.mockRestore();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  it(
    "inherits a parent review when the config model id is provider-prefixed but the stored model_used is bare",
    async () => {
      // Regression: file reviews persist the bare model id (e.g. `gemini-3.1-flash-lite`) while the
      // configured strategy stores the provider-qualified id (e.g. `google:gemini-3.1-flash-lite`).
      // Inheritance must match on the bare name; otherwise every retry re-reviews every file.
      const { ModelRunner } = await import("@codraoss/models");
      const reviewSpy = vi.spyOn(ModelRunner.prototype, "reviewFile");
      const repo = uniqueRepo("retry-prefix");
      const sourceHeadSha = sha("a");
      const retryHeadSha = sha("b");
      const baseSha = sha("0");

      const prefixedConfig = {
        ...defaultRepoConfig,
        model: {
          main: "google:gemini-3.1-flash-lite",
          fallbacks: ["google:gemini-2.5-flash-lite"],
          size_overrides: [],
        },
      };

      const source = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 7,
        prTitle: "Retry Prefix Match",
        prAuthor: "author",
        commitSha: sourceHeadSha,
        baseSha,
        trigger: "auto",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: prefixedConfig,
      });

      await upsertFileReview(env, source.id, {
        filePath: "src/app.ts",
        fileStatus: "done",
        modelUsed: "gemini-3.1-flash-lite", // bare, as the model service actually stores it
        modelProvider: "google",
        diffLineCount: 1,
        diffInput: "old diff",
        rawAiOutput: "{}",
        parsedComments: [
          {
            path: "src/app.ts",
            line: 1,
            position: 1,
            severity: "P2",
            category: "quality",
            title: "Inherited finding",
            body: "This comment must survive inheritance",
          },
        ],
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
        verdict: "comment",
        fileSummary: "inherited-summary",
        errorMessage: null,
      });

      const retry = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 7,
        prTitle: "Retry Prefix Match",
        prAuthor: "author",
        commitSha: retryHeadSha,
        baseSha,
        trigger: "retry",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: prefixedConfig,
        retryOfJobId: source.id,
      });

      await runAndDrain({
        jobId: retry.id,
        deliveryId: "delivery-retry-prefix-match",
      });

      // The file must be inherited verbatim (bare model id + parent summary preserved), not re-reviewed.
      expect(reviewSpy).not.toHaveBeenCalled();
      const reviews = await getFileReviewsForJobs(env, [retry.id]);
      const inherited = reviews.find(
        (review) => review.file_path === "src/app.ts",
      );
      expect(inherited?.model_used).toBe("gemini-3.1-flash-lite");
      expect(inherited?.file_summary).toBe("inherited-summary");
      // The parent's comments must be carried over by the bulk-inherit copy, not lost.
      expect(inherited?.parsed_comments).toHaveLength(1);
      expect(
        (inherited?.parsed_comments as ParsedReviewComment[])[0]?.title,
      ).toBe("Inherited finding");
      reviewSpy.mockRestore();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  it(
    "resumes an existing queued duplicate job instead of stranding it",
    async () => {
      const repo = uniqueRepo("duplicate");
      const headSha = sha("4");
      const baseSha = sha("5");

      const existing = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 4,
        prTitle: "Duplicate Test",
        prAuthor: "author",
        commitSha: headSha,
        baseSha,
        trigger: "auto",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: defaultRepoConfig,
      });

      await runAndDrain({
        deliveryId: "delivery-duplicate",
        ...(normalizeGitHubWebhook("pull_request", {
          action: "opened",
          installation: { id: 123 },
          repository: { owner: { login: "test-owner" }, name: repo },
          pull_request: {
            number: 4,
            head: { sha: headSha, ref: "feature" },
            base: { sha: baseSha, ref: "main" },
            title: "Duplicate Test",
            user: { login: "author" },
            draft: false,
          },
        }) as any),
      });

      const finalJob = await getJobForProcessing(env, existing.id);
      expect(finalJob?.status).toBe("done");
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  it(
    "schedules a delayed continuation instead of spending queue retries on transient model failures",
    async () => {
      const { ModelRunner } = await import("@codraoss/models");
      const retryableError = Object.assign(
        new Error("Google API timed out after 45000ms"),
        { retryable: true },
      );
      const reviewSpy = vi
        .spyOn(ModelRunner.prototype, "reviewFile")
        .mockRejectedValue(retryableError);
      const repo = uniqueRepo("transient");
      const headSha = sha("6");
      const baseSha = sha("7");

      const job = await insertJob(env, {
        installationId: "123",
        owner: "test-owner",
        repo,
        prNumber: 5,
        prTitle: "Transient Test",
        prAuthor: "author",
        commitSha: headSha,
        baseSha,
        trigger: "auto",
        headRef: "feature",
        baseRef: "main",
        configSnapshot: defaultRepoConfig,
      });
      await updateJobFileCount(env, job.id, 1);
      await updateJobStep(env, job.id, "Preparation", { status: "done" });

      await runWithDb(env, async () => {
        (env.REVIEW_QUEUE as any).sent.length = 0;
        const result = await runReviewJob(env, {
          jobId: job.id,
          deliveryId: "delivery-transient",
          phase: "review",
        });

        // Transient model failure (not a subrequest limit) -> stays in-instance, freshInstance false.
        expect(result).toEqual({
          action: "next_phase",
          phase: "review",
          delaySeconds: 30,
          jobId: expect.any(String),
          freshInstance: false,
        });
        expect(reviewSpy).toHaveBeenCalled();
        expect((env.REVIEW_QUEUE as any).sent).toHaveLength(0);
      });

      const finalJob = await getJobForProcessing(env, job.id);
      expect(finalJob?.status).toBe("running");
      expect(finalJob?.lease_owner).toBeNull();

      reviewSpy.mockRestore();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );
});
