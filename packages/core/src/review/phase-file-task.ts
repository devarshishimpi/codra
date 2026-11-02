import { logger } from "../logger";
import type { FileDiff } from "../diff";
import type { RejectedExemplar } from "../prompts/file-review";
import type {
  ParsedReviewComment,
  RepoConfig,
} from "@codraoss/schema";
import type {
  FileReviewRow,
  PullRequestRecord,
  ReviewModel,
  ReviewRuntime,
} from "../ports";
import type { PersistedReviewJob } from "./phase-control";
import {
  canInheritParentFileReview,
  isAwaitingAsyncReview,
} from "./retry-policy";
import {
  persistCompletedReview,
  reviewAndPersistFile,
} from "./file-runner";

export async function executeFileReviewTask(params: {
  env: ReviewRuntime;
  job: PersistedReviewJob;
  file: FileDiff;
  pr: PullRequestRecord;
  config: RepoConfig;
  totalLineCount: number;
  model: ReviewModel;
  resolveFailureModelProvider: () => Promise<string | null>;
  existingReview?: FileReviewRow | null;
  inherited?: FileReviewRow | null;
  rejectedExemplars: readonly RejectedExemplar[];
  changelogExcerpt?: string | null;
  fileContextFor: () => Promise<string | null>;
  currentReviews: Map<string, FileReviewRow>;
}): Promise<{ terminal: number; awaitingAsync: number }> {
  const {
    env,
    job,
    file,
    pr,
    config,
    totalLineCount,
    model,
    resolveFailureModelProvider,
    existingReview,
    inherited,
    rejectedExemplars,
    changelogExcerpt,
    fileContextFor,
    currentReviews,
  } = params;

  const awaitingReview =
    existingReview && isAwaitingAsyncReview(existingReview)
      ? existingReview
      : null;

  if (awaitingReview) {
    const poll = await model.pollReviewBatch({
      model: awaitingReview.async_model ?? awaitingReview.model_used,
      requestId: awaitingReview.async_request_id!,
      file,
      config,
    });
    if (poll.status === "pending") {
      return { terminal: 0, awaitingAsync: 1 };
    }
    if (poll.status === "failed") {
      logger.warn(
        `Async batch poll failed for ${file.path}; falling back to synchronous review`,
        {
          error:
            poll.error instanceof Error
              ? poll.error.message
              : String(poll.error),
        },
      );
      await reviewAndPersistFile(
        env,
        job,
        file,
        pr,
        config,
        totalLineCount,
        model,
        resolveFailureModelProvider,
        existingReview ?? undefined,
        rejectedExemplars,
        changelogExcerpt,
        await fileContextFor(),
      );
      return { terminal: 1, awaitingAsync: 0 };
    }
    await persistCompletedReview(env, job, file, poll.response);
    return { terminal: 1, awaitingAsync: 0 };
  }

  if (!inherited) {
    const submitted = await model.submitReviewBatch({
      file,
      fileContext: await fileContextFor(),
      prTitle: pr.title ?? null,
      prDescription: pr.body ?? null,
      changelogExcerpt,
      config,
      totalLineCount,
      compactPrompt: (existingReview?.transient_error_count ?? 0) > 0,
    });
    if (submitted) {
      await env.fileReviews.upsertFileReview(job.id, {
        filePath: file.path,
        fileStatus: "pending",
        modelUsed: submitted.model,
        modelProvider: null,
        diffLineCount: file.lineCount,
        diffInput: null,
        rawAiOutput: null,
        parsedComments: [],
        inputTokens: null,
        outputTokens: null,
        durationMs: null,
        verdict: null,
        fileSummary: null,
        overallCorrectness: null,
        confidenceScore: null,
        errorMessage: null,
        asyncRequestId: submitted.requestId,
        asyncModel: submitted.model,
      });
      return { terminal: 0, awaitingAsync: 1 };
    }
    await reviewAndPersistFile(
      env,
      job,
      file,
      pr,
      config,
      totalLineCount,
      model,
      resolveFailureModelProvider,
      existingReview ?? undefined,
      rejectedExemplars,
      changelogExcerpt,
      await fileContextFor(),
    );
    return { terminal: 1, awaitingAsync: 0 };
  }

  if (!canInheritParentFileReview(config, inherited)) {
    logger.info(
      `Ignoring inherited review for ${file.path}; parent model ${inherited.model_used} is not in the current model strategy`,
    );
    await reviewAndPersistFile(
      env,
      job,
      file,
      pr,
      config,
      totalLineCount,
      model,
      resolveFailureModelProvider,
      existingReview ?? undefined,
      rejectedExemplars,
      changelogExcerpt,
      await fileContextFor(),
    );
    return { terminal: 1, awaitingAsync: 0 };
  }

  await env.fileReviews.upsertFileReview(job.id, {
    filePath: file.path,
    fileStatus: "done",
    modelUsed: inherited.model_used,
    modelProvider: inherited.model_provider,
    diffLineCount: inherited.diff_line_count,
    diffInput: inherited.diff_input,
    rawAiOutput: inherited.raw_ai_output,
    parsedComments: inherited.parsed_comments as ParsedReviewComment[],
    inputTokens: inherited.input_tokens,
    outputTokens: inherited.output_tokens,
    durationMs: inherited.duration_ms,
    verdict: inherited.verdict,
    fileSummary: inherited.file_summary,
    overallCorrectness: inherited.overall_correctness,
    confidenceScore: inherited.confidence_score,
    errorMessage: null,
  });
  currentReviews.set(file.path, inherited);
  return { terminal: 1, awaitingAsync: 0 };
}
