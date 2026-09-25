import { BIN_MAX_FILES, runReviewJob } from "@server/core/review";
import {
  createTestEnv,
  dbDescribe,
  generateMockDiff,
  sha,
  uniqueRepo,
} from "../helpers";
import { afterEach, expect, it, vi } from "vitest";
import {
  insertJob,
  updateJobFileCount,
  updateJobStep,
} from "@codraoss/db/jobs";
import { getFileReviewsForJobs } from "@codraoss/db/file-reviews";
import { defaultRepoConfig } from "@codraoss/schema";
import { runWithDb } from "@codraoss/db/client";
import { REVIEW_FLOW_TIMEOUT_MS } from "../mocks/review-harness";

vi.mock("@codraoss/db/jobs", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, getOtherRunningJobsCount: vi.fn().mockResolvedValue(0) };
});

vi.mock("@codraoss/db/app-settings", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const { reviewSettingsSchema } = await import("@codraoss/schema");
  return {
    ...mod,
    getReviewSettings: vi
      .fn()
      .mockResolvedValue(reviewSettingsSchema.parse({})),
  };
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

const batchingConfig = {
  ...defaultRepoConfig,
  review: { ...defaultRepoConfig.review, batch_small_files: true },
};

const smallFiles = Array.from({ length: BIN_MAX_FILES }, (_unused, index) => ({
  path: `src/${String.fromCharCode(97 + index)}.ts`,
  content: `console.log(${index + 1});`,
}));

async function seedJob(
  env: ReturnType<typeof createTestEnv>,
  repo: string,
  config = batchingConfig,
) {
  const job = await insertJob(env, {
    installationId: "123",
    owner: "test-owner",
    repo,
    prNumber: 7,
    prTitle: "Batching",
    prAuthor: "author",
    commitSha: sha("a"),
    baseSha: sha("b"),
    trigger: "auto",
    headRef: "feature",
    baseRef: "main",
    configSnapshot: config,
  });
  await updateJobFileCount(env, job.id, smallFiles.length);
  await updateJobStep(env, job.id, "Preparation", { status: "done" });
  return job;
}

dbDescribe("Review flow: batched small files", () => {
  const env = createTestEnv();

  // Spies stack on the same prototypes across two runReviewJob calls, and a leaked spy
  // makes them fail only when interleaved.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "reviews several small files in one call and writes a row per file",
    async () => {
      const { GitHubService } = await import("@codraoss/provider-github");
      const { ModelRunner } = await import("@codraoss/models");
      const getDiffSpy = vi
        .spyOn(GitHubService.prototype, "getPullRequestDiff")
        .mockResolvedValue(generateMockDiff(smallFiles));

      const reviewFilesSpy = vi.spyOn(
        ModelRunner.prototype as any,
        "reviewFiles",
      );
      const reviewFileSpy = vi.spyOn(
        ModelRunner.prototype as any,
        "reviewFile",
      );

      const job = await seedJob(env, uniqueRepo("batch-happy"));

      await runWithDb(env, async () => {
        await runReviewJob(env, {
          jobId: job.id,
          deliveryId: "delivery-batch",
          phase: "review",
        });
      });

      // The whole point: a bin's worth of files, ONE model call.
      expect(reviewFilesSpy).toHaveBeenCalledTimes(1);
      expect(
        (
          reviewFilesSpy.mock.calls[0][0] as { files: Array<{ path: string }> }
        ).files.map((f) => f.path),
      ).toEqual(smallFiles.map((f) => f.path));
      expect(reviewFileSpy).not.toHaveBeenCalled();

      const reviews = await getFileReviewsForJobs(env, [job.id]);
      expect(reviews).toHaveLength(smallFiles.length);
      for (const review of reviews) {
        expect(review.file_status).toBe("done");
        expect(review.batch_size).toBe(smallFiles.length);
        // Per-file summary, not one shared string: the reason for the nested response shape.
        expect(review.file_summary).toBe(`Looks ok: ${review.file_path}`);
        expect(review.parsed_comments).toHaveLength(1);
        expect(review.parsed_comments[0].title).toBe(
          `Typo in ${review.file_path}`,
        );
      }

      // The split parts must sum to what the call actually cost.
      expect(reviews.reduce((sum, r) => sum + (r.input_tokens ?? 0), 0)).toBe(
        40,
      );
      expect(reviews.reduce((sum, r) => sum + (r.output_tokens ?? 0), 0)).toBe(
        12,
      );

      reviewFilesSpy.mockRestore();
      reviewFileSpy.mockRestore();
      getDiffSpy.mockRestore();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  // An error after the write must not take committed rows down: the catch-all's comment DELETE
  // would wipe correct findings.
  it(
    "keeps already-committed rows when a later step fails",
    async () => {
      const { GitHubService } = await import("@codraoss/provider-github");
      const { ModelRunner } = await import("@codraoss/models");
      const { reviewBatchResponse } = await import("../mocks/services");
      const fileReviews = await import("@codraoss/db/file-reviews");
      vi.spyOn(GitHubService.prototype, "getPullRequestDiff").mockResolvedValue(
        generateMockDiff(smallFiles),
      );

      vi.spyOn(ModelRunner.prototype as any, "reviewFiles").mockImplementation(
        async () => {
          const response = reviewBatchResponse(["src/a.ts", "src/b.ts"]);
          response.batch.missing = ["src/c.ts"];
          return response;
        },
      );
      // Fails only the missing-file bookkeeping, after a.ts and b.ts are already durably `done`.
      vi.spyOn(
        fileReviews,
        "bulkRecordRetryableFileReviewFailures",
      ).mockRejectedValue(new Error("connection reset by peer"));

      const job = await seedJob(env, uniqueRepo("batch-partial-fail"));

      await runWithDb(env, async () => {
        await runReviewJob(env, {
          jobId: job.id,
          deliveryId: "delivery-partialfail",
          phase: "review",
        }).catch(() => undefined);
      });

      const reviews = await getFileReviewsForJobs(env, [job.id]);
      for (const path of ["src/a.ts", "src/b.ts"]) {
        const row = reviews.find((r) => r.file_path === path)!;
        expect(row.file_status).toBe("done");
        expect(row.parsed_comments).toHaveLength(1);
      }
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  // A silently omitted file is re-queued as retryable, and is not progress for the wedge counter.
  it(
    "re-queues a file the model omitted instead of approving it",
    async () => {
      const { GitHubService } = await import("@codraoss/provider-github");
      const { ModelRunner } = await import("@codraoss/models");
      const { reviewBatchResponse } = await import("../mocks/services");
      const jobsModule = await import("@codraoss/db/jobs");
      const getDiffSpy = vi
        .spyOn(GitHubService.prototype, "getPullRequestDiff")
        .mockResolvedValue(generateMockDiff(smallFiles));

      const resetSpy = vi.spyOn(jobsModule, "resetJobContinuationCount");
      const reviewFilesSpy = vi
        .spyOn(ModelRunner.prototype as any, "reviewFiles")
        .mockImplementation(async () => {
          const response = reviewBatchResponse([]);
          response.batch.missing = smallFiles.map((f) => f.path);
          return response;
        });

      const job = await seedJob(env, uniqueRepo("batch-missing"));

      await runWithDb(env, async () => {
        await runReviewJob(env, {
          jobId: job.id,
          deliveryId: "delivery-batch-missing",
          phase: "review",
        }).catch(() => undefined);
      });

      expect(resetSpy).not.toHaveBeenCalled();

      const reviews = await getFileReviewsForJobs(env, [job.id]);
      expect(reviews).toHaveLength(smallFiles.length);
      for (const row of reviews) {
        expect(row.file_status).toBe("failed");
        expect(row.transient_error_count).toBe(1);
        expect(row.error_msg).toContain("retrying later");
      }

      reviewFilesSpy.mockRestore();
      getDiffSpy.mockRestore();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );

  // After a transient failure the bin must not re-form. The ledger is seeded directly: a real
  // failure also sets a 30s job delay, which would pass for the wrong reason.
  it(
    "falls back to single-file reviews once a bin member has failed transiently",
    async () => {
      const { GitHubService } = await import("@codraoss/provider-github");
      const { ModelRunner } = await import("@codraoss/models");
      const { bulkRecordRetryableFileReviewFailures } =
        await import("@codraoss/db/file-reviews");
      vi.spyOn(GitHubService.prototype, "getPullRequestDiff").mockResolvedValue(
        generateMockDiff(smallFiles),
      );

      const job = await seedJob(env, uniqueRepo("batch-deescalate"));
      await bulkRecordRetryableFileReviewFailures(env, job.id, [
        {
          filePath: "src/b.ts",
          modelUsed: "test-model",
          diffLineCount: 1,
          errorMessage: "provider outage; retrying later",
        },
      ]);

      const reviewFilesSpy = vi.spyOn(
        ModelRunner.prototype as any,
        "reviewFiles",
      );
      const reviewFileSpy = vi.spyOn(
        ModelRunner.prototype as any,
        "reviewFile",
      );

      await runWithDb(env, async () => {
        await runReviewJob(env, {
          jobId: job.id,
          deliveryId: "delivery-d2",
          phase: "review",
        }).catch(() => undefined);
      });

      expect(reviewFilesSpy).not.toHaveBeenCalled();
      expect(reviewFileSpy).toHaveBeenCalled();
    },
    REVIEW_FLOW_TIMEOUT_MS,
  );
});
