import { logger } from "../logger";
import {
  defaultRepoConfig,
  REVIEW_CONCURRENCY_LIMITS,
  type ParsedReviewComment,
  type RepoConfig,
} from "@codraoss/schema";
import { budgetAwareFileLimit } from "./budget";
import { narrowUnit, planReviewUnits } from "./pack";
import { reviewAndPersistBin } from "./bin-runner";
import { getDiffFiles } from "./diff-cache";
import {
  changelogExcerptFromDiff,
  wantsFileContext,
} from "../prompts/file-review";
import { loadFileContext } from "./file-context";
import type { ReviewGitProvider, ReviewModel, ReviewRuntime } from "../ports";
import { TokenTracker } from "../token-tracker";
import {
  type PersistedReviewJob,
  NextPhaseError,
  enqueueJobPhase,
  hasCompletedStep,
  heartbeatAndCheckSuperseded,
} from "./phase-control";
import {
  ASYNC_BATCH_POLL_DELAY_SECONDS,
  FRESH_INVOCATION_YIELD_SECONDS,
  MAX_JOB_CONTINUATIONS,
  REVIEW_CHUNK_WALL_CLOCK_MS,
} from "../constants";
import {
  canInheritParentFileReview,
  countsAsHandledFileReview,
  isAwaitingAsyncReview,
  isSubrequestBudgetError,
  resolveModelProviderName,
} from "./retry-policy";
import { loadRejectedExemplars, runPreparePhase } from "./prepare";
import {
  persistCompletedReview,
  persistFailedFileReview,
  reviewAndPersistFile,
} from "./file-runner";

export async function runReviewPhase(
  env: ReviewRuntime,
  job: PersistedReviewJob,
  leaseOwner: string,
  github: ReviewGitProvider,
  model: ReviewModel,
  tracker: TokenTracker,
) {
  if (!hasCompletedStep(job, "Preparation")) {
    await runPreparePhase(env, job, leaseOwner, github);
    return;
  }

  await env.jobs.updateJobStep(job.id, "Reviewing Files", {
    status: "running",
  });

  const [rejectedExemplars, pr] = await Promise.all([
    loadRejectedExemplars(env, job),
    github.getPullRequest(job.owner, job.repo, job.prNumber),
  ]);
  const config = (job.configSnapshot ?? defaultRepoConfig) as RepoConfig;
  const failureModelId = config.model?.main ?? "unconfigured";
  let failureModelProviderPromise: Promise<string | null> | null = null;
  const resolveFailureModelProvider = () => {
    failureModelProviderPromise ??= resolveModelProviderName(
      env,
      failureModelId,
    );
    return failureModelProviderPromise;
  };
  const { concurrencyLevel, maxFiles } = await env.settings.getReviewSettings();
  const { files } = await getDiffFiles(env, job, github, config, maxFiles);
  const totalLineCount = files.reduce((sum, file) => sum + file.lineCount, 0);
  const changelogExcerpt = changelogExcerptFromDiff(files);
  const configuredChunkFileLimit = REVIEW_CONCURRENCY_LIMITS[concurrencyLevel];
  const modelChainLength = 1 + (config.model.fallbacks?.length ?? 0);
  const reviewChunkFileLimit = budgetAwareFileLimit(
    tracker.remainingSafeBudget(),
    configuredChunkFileLimit,
    modelChainLength,
    config.review.full_file_context,
    // A second reviewer walks its own chain per file, so fewer files fit in one invocation.
    Boolean(config.model?.secondary),
  );
  if (reviewChunkFileLimit <= 0) {
    throw new Error(
      "Subrequest budget for this invocation was exhausted before starting the next review chunk.",
    );
  }
  const startedAt = env.clock.now();
  let processedThisChunk = 0;

  const jobIdsToQuery = [job.id];
  if (job.retryOfJobId) jobIdsToQuery.push(job.retryOfJobId);
  const allExistingReviews =
    await env.fileReviews.getFileReviewsForJobs(jobIdsToQuery);
  type ExistingReview = (typeof allExistingReviews)[number];
  const currentReviews = new Map<string, ExistingReview>();
  const parentReviews = new Map<string, ExistingReview>();
  for (const review of allExistingReviews) {
    if (review.job_id === job.id) currentReviews.set(review.file_path, review);
    else if (review.file_status === "done")
      parentReviews.set(review.file_path, review);
  }

  const reviewTasks: Array<Promise<void>> = [];
  let terminalProgress = 0;
  let awaitingAsync = 0;

  if (job.retryOfJobId && parentReviews.size > 0) {
    const inheritablePaths = files.flatMap((file) => {
      if (currentReviews.has(file.path)) return [];
      const parent = parentReviews.get(file.path);
      return parent && canInheritParentFileReview(config, parent)
        ? [file.path]
        : [];
    });

    if (inheritablePaths.length > 0) {
      const inheritedPaths = await env.fileReviews.bulkInheritFileReviews({
        jobId: job.id,
        parentJobId: job.retryOfJobId,
        filePaths: inheritablePaths,
      });
      for (const path of inheritedPaths) {
        const parent = parentReviews.get(path);
        if (parent) currentReviews.set(path, parent);
      }
      terminalProgress += inheritedPaths.length;
      if (inheritedPaths.length > 0) {
        logger.info(
          `Bulk-inherited ${inheritedPaths.length} parent file reviews for job ${job.id} in one pass`,
        );
      }
    }
  }

  const binnedPaths = new Set<string>();
  if (config.review.batch_small_files) {
    const ledger = new Map(
      files.map((file) => {
        const existing = currentReviews.get(file.path);
        const inheritable = parentReviews.get(file.path);
        return [
          file.path,
          {
            handled: Boolean(
              (existing && countsAsHandledFileReview(existing)) ||
              (inheritable && canInheritParentFileReview(config, inheritable)),
            ),
            transientErrorCount: existing?.transient_error_count ?? 0,
          },
        ];
      }),
    );

    const units = planReviewUnits(files, {
      enabled: true,
      fullFileContext: config.review.full_file_context,
    }).flatMap((unit) => narrowUnit(unit, ledger));
    const plannedBins = units.filter((unit) => unit.kind === "bin");
    let binsDispatched = 0;
    let filesDispatchedInBins = 0;

    for (const unit of plannedBins) {
      if (processedThisChunk >= reviewChunkFileLimit) break;
      if (env.clock.now() - startedAt >= REVIEW_CHUNK_WALL_CLOCK_MS) break;

      const binFiles = unit.kind === "bin" ? unit.files : [];
      binFiles.forEach((file) => binnedPaths.add(file.path));
      reviewTasks.push(
        (async () => {
          const terminal = await reviewAndPersistBin(
            env,
            job,
            binFiles,
            pr,
            config,
            totalLineCount,
            model,
            resolveFailureModelProvider,
            rejectedExemplars,
            changelogExcerpt,
          );
          terminalProgress += terminal;
        })(),
      );
      processedThisChunk += 1;
      binsDispatched += 1;
      filesDispatchedInBins += binFiles.length;
    }

    if (plannedBins.length > 0) {
      logger.info("Batched review plan", {
        jobId: job.id,
        binsPlanned: plannedBins.length,
        binsDispatched,
        filesInBins: filesDispatchedInBins,
        modelCallsSaved: filesDispatchedInBins - binsDispatched,
      });
    }
  }

  for (const file of files) {
    if (binnedPaths.has(file.path)) continue;

    const existingReview = currentReviews.get(file.path);
    const awaitingReview =
      existingReview && isAwaitingAsyncReview(existingReview)
        ? existingReview
        : null;
    if (
      existingReview &&
      countsAsHandledFileReview(existingReview) &&
      !awaitingReview
    ) {
      continue;
    }

    if (!awaitingReview && processedThisChunk >= reviewChunkFileLimit) {
      continue;
    }

    const inherited = parentReviews.get(file.path);
    let fileContextPromise: Promise<string | null> | null = null;
    const fileContextFor = () => {
      if (
        !wantsFileContext(file, config.review.full_file_context, {
          compactPrompt: (existingReview?.transient_error_count ?? 0) > 0,
        })
      ) {
        return Promise.resolve(null);
      }
      fileContextPromise ??= loadFileContext(github, job, file, () =>
        tracker.incrementSubrequests(1),
      );
      return fileContextPromise;
    };
    const reviewTask = async () => {
      if (awaitingReview) {
        const poll = await model.pollReviewBatch({
          model: awaitingReview.async_model ?? awaitingReview.model_used,
          requestId: awaitingReview.async_request_id!,
          file,
          config,
        });
        if (poll.status === "pending") {
          awaitingAsync += 1;
          return;
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
            existingReview,
            rejectedExemplars,
            changelogExcerpt,
            await fileContextFor(),
          );
          terminalProgress += 1;
          return;
        }
        await persistCompletedReview(env, job, file, poll.response);
        terminalProgress += 1;
        return;
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
          awaitingAsync += 1;
          return;
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
          existingReview,
          rejectedExemplars,
          changelogExcerpt,
          await fileContextFor(),
        );
        terminalProgress += 1;
        return;
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
          existingReview,
          rejectedExemplars,
          changelogExcerpt,
          await fileContextFor(),
        );
        terminalProgress += 1;
      } else {
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
        terminalProgress += 1;
      }
    };

    reviewTasks.push(reviewTask());
    if (!awaitingReview) processedThisChunk += 1;

    if (env.clock.now() - startedAt >= REVIEW_CHUNK_WALL_CLOCK_MS) {
      break;
    }
  }

  const results = await Promise.allSettled(reviewTasks);
  await heartbeatAndCheckSuperseded(env, job.id, leaseOwner);

  if (terminalProgress > 0) {
    await env.jobs.resetJobContinuationCount(job.id);
  }

  logger.info("Review chunk model usage", {
    jobId: job.id,
    subrequests: tracker.getSubrequestCount(),
    usage: tracker.getTotalUsage(),
    wasted: tracker.getWasted(),
  });

  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected.length > 0) {
    rejected.forEach((result, index) => {
      logger.error(
        `Review chunk task ${index + 1}/${rejected.length} failed`,
        result.reason,
      );
    });

    const deferrableError = rejected
      .map((r) => r.reason)
      .find(
        (r) =>
          env.modelErrors.isRetryableModelError(r) ||
          isSubrequestBudgetError(r),
      );
    if (deferrableError) {
      throw deferrableError;
    }

    throw rejected.length === 1
      ? rejected[0].reason
      : new AggregateError(
          rejected.map((result) => result.reason),
          `${rejected.length} review chunk tasks failed`,
        );
  }

  const latestReviews = await env.fileReviews.getFileReviewsForJobs([job.id]);
  const reviewedPaths = new Set(
    latestReviews.flatMap((review) =>
      countsAsHandledFileReview(review) && !isAwaitingAsyncReview(review)
        ? [review.file_path]
        : [],
    ),
  );
  const completedCount = files.filter((file) =>
    reviewedPaths.has(file.path),
  ).length;

  if (completedCount >= files.length) {
    await env.jobs.updateJobStep(job.id, "Reviewing Files", { status: "done" });
    await enqueueJobPhase(
      env,
      job.id,
      "finalize",
      FRESH_INVOCATION_YIELD_SECONDS,
    );
    return;
  }

  if (awaitingAsync > 0 && terminalProgress === 0) {
    const pollCount = await env.jobs.markJobContinuationQueued(
      job.id,
      ASYNC_BATCH_POLL_DELAY_SECONDS,
    );
    if (pollCount > MAX_JOB_CONTINUATIONS) {
      logger.error(
        `Async batch reviews did not complete after ${pollCount} polls; degrading to a partial review: ${job.owner}/${job.repo} PR #${job.prNumber}`,
      );
      for (const review of latestReviews.filter(isAwaitingAsyncReview)) {
        await persistFailedFileReview(env, job.id, {
          filePath: review.file_path,
          modelUsed: review.async_model ?? review.model_used,
          diffLineCount: review.diff_line_count,
          errorMessage: "Async batch review did not complete in time.",
          clearAsync: true,
        });
      }
      await env.jobs.updateJobStep(job.id, "Reviewing Files", {
        status: "done",
      });
      throw new NextPhaseError("finalize", FRESH_INVOCATION_YIELD_SECONDS);
    }
    throw new NextPhaseError("review", ASYNC_BATCH_POLL_DELAY_SECONDS);
  }

  if (job.checkRunId) {
    try {
      await github.updateCheckRun(job.owner, job.repo, job.checkRunId, {
        title: `Reviewing (${completedCount}/${files.length})`,
        summary: "Codra is continuing this review in the next queue chunk.",
      });
    } catch (error) {
      logger.warn(
        `Failed to update progress check run for job ${job.id}; continuing to the next chunk anyway`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
  await enqueueJobPhase(env, job.id, "review", FRESH_INVOCATION_YIELD_SECONDS);
}
