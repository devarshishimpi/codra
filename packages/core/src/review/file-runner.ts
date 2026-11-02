import { logger } from "../logger";
import { type ParsedReviewComment, type RepoConfig } from "@codraoss/schema";
import { parseUnifiedDiff, type FileDiff } from "../diff";
import {
  ruleHitsToComments,
  scanFileForRuleHits,
  type RuleScanStats,
} from "../rules/detect";
import type { RejectedExemplar } from "../prompts/file-review";
import type { PullRequestRecord, ReviewModel, ReviewRuntime } from "../ports";
import { type PersistedReviewJob } from "./phase-control";
import {
  FRESH_INVOCATION_YIELD_SECONDS,
  MAX_RETRYABLE_FILE_REVIEW_FAILURES,
} from "../constants";
import {
  isSubrequestBudgetError,
  retryableModelFailureDelaySeconds,
} from "./retry-policy";

export async function persistCompletedReview(
  env: Pick<ReviewRuntime, "fileReviews">,
  job: PersistedReviewJob,
  file: ReturnType<typeof parseUnifiedDiff>[number],
  response: {
    modelUsed: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    rawText: string;
    userPrompt: string;
    parsed: {
      comments: ParsedReviewComment[];
      verdict: "approve" | "comment";
      fileSummary: string;
      overallCorrectness?: string;
      confidenceScore?: number;
    };
  },
) {
  await env.fileReviews.upsertFileReview(job.id, {
    filePath: file.path,
    fileStatus: "done",
    modelUsed: response.modelUsed,
    modelProvider: response.provider,
    diffLineCount: file.lineCount,
    diffInput: null,
    rawAiOutput: response.rawText,
    parsedComments: response.parsed.comments,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    durationMs: null,
    verdict: response.parsed.verdict,
    fileSummary: response.parsed.fileSummary,
    overallCorrectness: response.parsed.overallCorrectness,
    confidenceScore: response.parsed.confidenceScore,
    errorMessage: null,
    asyncRequestId: null,
    asyncModel: null,
  });
}

export async function persistFailedFileReview(
  env: Pick<ReviewRuntime, "fileReviews">,
  jobId: string,
  input: {
    filePath: string;
    modelUsed: string;
    modelProvider?: string | null;
    diffLineCount: number;
    durationMs?: number | null;
    errorMessage: string;
    clearAsync?: boolean;
    parsedComments?: ParsedReviewComment[];
  },
) {
  await env.fileReviews.upsertFileReview(jobId, {
    filePath: input.filePath,
    fileStatus: "failed",
    modelUsed: input.modelUsed,
    modelProvider: input.modelProvider ?? null,
    diffLineCount: input.diffLineCount,
    diffInput: null,
    rawAiOutput: null,
    parsedComments: input.parsedComments ?? [],
    inputTokens: null,
    outputTokens: null,
    durationMs: input.durationMs ?? null,
    verdict: null,
    fileSummary: null,
    errorMessage: input.errorMessage,
    ...(input.clearAsync ? { asyncRequestId: null, asyncModel: null } : {}),
  });
}

export function scanRuleChannel(
  file: FileDiff,
  config: RepoConfig,
): { comments: ParsedReviewComment[]; stats: RuleScanStats | null } {
  const rules = config.review.rules;
  if (!rules?.enabled) return { comments: [], stats: null };

  try {
    const result = scanFileForRuleHits(file, {
      disabledRuleIds: rules.disabled_rule_ids,
      shadowRuleIds: rules.shadow_rule_ids,
      deniedClaimTypes: config.review.deny_claim_types,
    });
    return { comments: ruleHitsToComments(file, result), stats: result.stats };
  } catch (error) {
    logger.warn(
      `Rule scan failed for ${file.path}; continuing with LLM findings only`,
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return { comments: [], stats: null };
  }
}

/**
 * Marks who found what, for display only.
 *
 * Explicitly NOT for scoring. In the measured corpus, claims found by seven configurations were right
 * 7% of the time against 20% for claims found by one -- so the fact that both reviewers found
 * something is not a reason to trust it more, and this field must never become a weight.
 */
function tagReviewer(
  comments: ParsedReviewComment[],
  reviewerModel: string,
): ParsedReviewComment[] {
  return comments.map((comment) => ({ ...comment, reviewerModel }));
}

/** Never throws: the primary review already succeeded, and a second opinion is not worth losing it. */
async function runSecondaryReview(
  model: ReviewModel,
  params: Parameters<ReviewModel["reviewFile"]>[0],
  secondary: { model: string; fallbacks: string[] },
  path: string,
) {
  try {
    // `selectModel` reads `config.model`, so swapping it is the whole mechanism -- no second runner,
    // no second chain type. `size_overrides` are deliberately not carried: the secondary is one
    // deliberate choice, not a size ladder.
    return await model.reviewFile({
      ...params,
      config: {
        ...params.config,
        model: {
          ...params.config.model,
          main: secondary.model,
          fallbacks: secondary.fallbacks,
        },
      },
    });
  } catch (error) {
    logger.warn(
      `Secondary reviewer failed for ${path}; keeping the primary review`,
      {
        model: secondary.model,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  }
}

export async function reviewAndPersistFile(
  env: ReviewRuntime,
  job: PersistedReviewJob,
  file: ReturnType<typeof parseUnifiedDiff>[number],
  pr: PullRequestRecord,
  config: RepoConfig,
  totalLineCount: number,
  model: ReviewModel,
  resolveFailureModelProvider: () => Promise<string | null>,
  previousReview?: { transient_error_count: number },
  rejectedExemplars: readonly RejectedExemplar[] = [],
  changelogExcerpt: string | null = null,
  fileContext: string | null = null,
) {
  const startedAt = env.clock.now();
  const compactPrompt = (previousReview?.transient_error_count ?? 0) > 0;

  const ruleScan = scanRuleChannel(file, config);

  try {
    const reviewParams = {
      file,
      fileContext,
      prTitle: pr.title ?? null,
      prDescription: pr.body ?? null,
      changelogExcerpt,
      config,
      totalLineCount,
      compactPrompt,
      rejectedExemplars,
    };

    const response = await model.reviewFile(reviewParams);

    // A second, independent reviewer over the same file. Its findings are UNIONED with the primary's:
    // the measured gain from two reviewers is entirely coverage, and nothing here counts agreement.
    //
    // Best-effort by construction. The primary's result already exists, so a failing secondary must
    // never cost the file -- it logs and the review stands on the primary alone. Skipped when
    // `compactPrompt` is set, because that flag means the last attempt was already too much.
    const secondary = config.model?.secondary ?? null;
    const secondaryReview =
      secondary && !compactPrompt
        ? await runSecondaryReview(model, reviewParams, secondary, file.path)
        : null;

    const llmComments = [
      ...tagReviewer(response.parsed.comments, response.modelUsed),
      ...(secondaryReview
        ? tagReviewer(
            secondaryReview.parsed.comments,
            secondaryReview.modelUsed,
          )
        : []),
    ];

    await env.fileReviews.upsertFileReview(job.id, {
      filePath: file.path,
      fileStatus: "done",
      modelUsed: response.modelUsed,
      modelProvider: response.provider,
      diffLineCount: file.lineCount,
      diffInput: null,
      rawAiOutput: response.rawText,
      // One row per file, always: `file_reviews` is unique on (job_id, file_path), and review
      // inheritance, resume and finalize all assume that. The two reviewers merge into it.
      parsedComments: [...llmComments, ...ruleScan.comments],
      inputTokens: response.inputTokens + (secondaryReview?.inputTokens ?? 0),
      outputTokens:
        response.outputTokens + (secondaryReview?.outputTokens ?? 0),
      durationMs: env.clock.now() - startedAt,
      verdict: response.parsed.verdict,
      fileSummary: response.parsed.fileSummary,
      overallCorrectness: response.parsed.overallCorrectness,
      confidenceScore: response.parsed.confidenceScore,
      errorMessage: null,
      withheldCounts: {
        evidence:
          (response.parsed.evidenceStats?.unmatched ?? 0) +
          (response.parsed.evidenceStats?.absent ?? 0) +
          (response.parsed.evidenceStats?.weak ?? 0),
        claimDenied: Object.values(
          response.parsed.deniedClaimCounts ?? {},
        ).reduce((sum, n) => sum + n, 0),
        // Findings about code the diff never touched. Counted apart from the evidence gate: those are
        // findings whose quote could not be found at all, these are ones that were found in the wrong
        // place, and only the second number says anything about how the reviewer is misreading a PR.
        contextOnly: response.parsed.evidenceStats?.contextOnly ?? 0,
        // "X is missing", answered by finding X. Counted so the gate's real hit rate is visible.
        absenceRefuted: response.parsed.absenceCheckStats?.refuted ?? 0,
      },
      // Only logged until now, which made "how often did a review run unconstrained or truncated?"
      // unanswerable without reading the logs of every job one at a time.
      degraded: response.degraded ?? null,
    });

    logger.info(`File review parsed: ${file.path}`, {
      jobId: job.id,
      model: response.modelUsed,
      kept: response.parsed.comments.length,
      evidence: response.parsed.evidenceStats,
      claimTypes: response.parsed.claimTypeCounts,
      deniedClaims: response.parsed.deniedClaimCounts,
      absenceCheck: response.parsed.absenceCheckStats,
      ruleChannel: ruleScan.stats,
      degraded: response.degraded,
    });

    if (response.wasPromptTruncated) {
      logger.warn(
        `Reviewed only part of ${file.path}; findings from the remainder are missing.`,
        {
          jobId: job.id,
          model: response.modelUsed,
          reviewedLineCount: response.reviewedLineCount,
          diffLineCount: file.lineCount,
        },
      );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown file review error";
    const modelId = config.model?.main ?? "unconfigured";
    const modelProvider = await resolveFailureModelProvider();

    if (isSubrequestBudgetError(error)) {
      logger.warn(
        `File review deferred for ${file.path}; subrequest budget will retry in a fresh invocation`,
        {
          error: errorMessage,
        },
      );
      Object.defineProperty(error, "retryAfterSeconds", {
        value: FRESH_INVOCATION_YIELD_SECONDS,
        configurable: true,
      });
      throw error;
    }

    if (env.modelErrors.isRetryableModelError(error)) {
      const failureCount =
        await env.fileReviews.recordRetryableFileReviewFailure(job.id, {
          filePath: file.path,
          modelUsed: modelId,
          modelProvider,
          diffLineCount: file.lineCount,
          diffInput: null,
          durationMs: env.clock.now() - startedAt,
          errorMessage,
          countsAsAttempt: env.modelErrors.nextChainIndexOf(error) === null,
        });

      if (failureCount >= MAX_RETRYABLE_FILE_REVIEW_FAILURES) {
        const finalError = `Review skipped after ${failureCount} repeated model provider outages.`;
        await persistFailedFileReview(env, job.id, {
          filePath: file.path,
          modelUsed: modelId,
          modelProvider,
          diffLineCount: file.lineCount,
          durationMs: env.clock.now() - startedAt,
          errorMessage: finalError,
          parsedComments: ruleScan.comments,
        });
        logger.error(
          `File review failed permanently for ${file.path} after transient retries`,
          {
            attempts: failureCount,
            error: errorMessage,
          },
        );
        return;
      }

      logger.warn(
        `File review deferred for ${file.path}; transient model/provider failure will retry later`,
        {
          error: errorMessage,
          attempts: failureCount,
        },
      );
      Object.defineProperty(error, "retryAfterSeconds", {
        value: retryableModelFailureDelaySeconds(failureCount),
        configurable: true,
      });
      throw error;
    }

    logger.error(`File review failed for ${file.path}`, { error });

    const isHardLimit =
      errorMessage.includes("4006") ||
      errorMessage.toLowerCase().includes("allocation");

    if (isHardLimit) {
      logger.warn(
        `File review hit hard provider allocation limit for ${file.path}, marking as failed to allow partial PR review.`,
        { error: errorMessage },
      );
    }

    await persistFailedFileReview(env, job.id, {
      filePath: file.path,
      modelUsed: modelId,
      modelProvider,
      diffLineCount: file.lineCount,
      durationMs: env.clock.now() - startedAt,
      errorMessage,
      parsedComments: ruleScan.comments,
    });
  }
}
