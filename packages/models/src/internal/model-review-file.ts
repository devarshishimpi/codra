import {
  buildBatchReviewPrompts,
  buildBatchReviewResponseSchema,
  buildFileReviewPrompts,
  buildReviewResponseSchema,
  type RejectedExemplar,
} from '@codraoss/core/prompts/file-review';
import { isNonAnswerReview, parseBatchReviewResponse, parseFileReviewResponse, type BatchReviewResult } from '@codraoss/core/model-output';
import { UnparseableModelResponseError } from '../types';
import { chunkFileDiff, type FileDiff } from '@codraoss/core/diff';
import { adaptiveModelTimeoutMs, reviewOutputBudgetTokens } from '../limits';
import { reviewBreadth } from '@codraoss/core/prompts/file-review';
import { mergeCounts } from './model-support';
import { type ModelReviewContext, runModelChain } from './model-review-chain';
import { logger } from '@codraoss/core/logger';
import type { RepoConfig } from '@codraoss/schema';
import type { ModelResponse } from '../types';

// vi.mock targets services/model barrel; import model from there, not here.

export const COMPACT_REVIEW_PROMPT_LINE_CAP = 400;
// Reserve so tail chunks only run if budget still fits another whole file.
const EXTRA_CHUNK_BUDGET_RESERVE = 8;
export type { ModelReviewContext };

export async function reviewFile(ctx: ModelReviewContext, params: {
  file: any;
  fileContext?: string | null;
  prTitle: string | null;
  prDescription: string | null;
  changelogExcerpt?: string | null;
  config: RepoConfig;
  totalLineCount: number;
  compactPrompt?: boolean;
  rejectedExemplars?: readonly RejectedExemplar[];
}) {
  const configuredLineCap = params.config.review.max_diff_lines_per_file;
  const modelLineCap = params.compactPrompt
    ? Math.min(configuredLineCap, COMPACT_REVIEW_PROMPT_LINE_CAP)
    : configuredLineCap;

  let chunks = chunkFileDiff(params.file, modelLineCap);
  const totalChunkCount = chunks.length;

  const BASE_CHUNKS = 4;
  const MAX_CHUNKS = 8;
  if (chunks.length > MAX_CHUNKS) {
    chunks = chunks.slice(0, MAX_CHUNKS);
  }

  if (chunks.length === 1) {
    return reviewFileChunk(ctx, { ...params, file: chunks[0] });
  }

  const results: Array<ModelResponse & { parsed: ReturnType<typeof parseFileReviewResponse>, reviewedLineCount: number, wasPromptTruncated: boolean, userPrompt: string }> = [];
  const { path: filePath } = params.file;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    // isNearLimit guards the ~50-subrequest cap.
    if (results.length > 0 && ctx.tracker?.isNearLimit()) {
      logger.warn(`Stopping chunk processing for ${filePath} early due to subrequest budget limits.`);
      break;
    }

    // Needs spare budget, not just remaining: isNearLimit only trips once already starved.
    if (chunkIndex >= BASE_CHUNKS) {
      const remaining = ctx.tracker?.remainingSafeBudget() ?? Number.POSITIVE_INFINITY;
      if (remaining < EXTRA_CHUNK_BUDGET_RESERVE) {
        logger.info(`Skipping the opportunistic chunk tail for ${filePath}; budget is committed elsewhere.`, {
          chunkIndex,
          totalChunks: chunks.length,
          remainingSafeBudget: remaining,
        });
        break;
      }
    }


    try {
      const res = await reviewFileChunk(ctx, { ...params, file: chunk });
      results.push(res as any);
    } catch (error) {
      if (results.length === 0) {
        throw error;
      }
      logger.warn(`Chunk review failed for ${filePath}, returning partial results to avoid stalling the job.`, { error: error instanceof Error ? error.message : String(error) });
      break;
    }
  }

  const combinedFindings = results.flatMap(r => r.parsed.comments);
  // Most serious verdict, not last: a clean final chunk would mask earlier findings.
  const primaryResult = results.find(r => r.parsed.verdict === 'comment') ?? results[results.length - 1];

  return {
    ...primaryResult,
    inputTokens: results.reduce((sum, r) => sum + r.inputTokens, 0),
    outputTokens: results.reduce((sum, r) => sum + r.outputTokens, 0),
    parsed: {
      ...primaryResult.parsed,
      comments: combinedFindings,
      evidenceStats: results.reduce((acc, r) => ({
        total: acc.total + (r.parsed.evidenceStats?.total ?? 0),
        matched: acc.matched + (r.parsed.evidenceStats?.matched ?? 0),
        unmatched: acc.unmatched + (r.parsed.evidenceStats?.unmatched ?? 0),
        weak: acc.weak + (r.parsed.evidenceStats?.weak ?? 0),
        absent: acc.absent + (r.parsed.evidenceStats?.absent ?? 0),
        contextOnly: acc.contextOnly + (r.parsed.evidenceStats?.contextOnly ?? 0),
      }), { total: 0, matched: 0, unmatched: 0, weak: 0, absent: 0, contextOnly: 0 }),
      claimTypeCounts: mergeCounts(results.map((r) => r.parsed.claimTypeCounts)),
      deniedClaimCounts: mergeCounts(results.map((r) => r.parsed.deniedClaimCounts)),
      absenceCheckStats: results.reduce((acc, r) => ({
        absenceShaped: acc.absenceShaped + (r.parsed.absenceCheckStats?.absenceShaped ?? 0),
        identifierExtracted: acc.identifierExtracted + (r.parsed.absenceCheckStats?.identifierExtracted ?? 0),
        refuted: acc.refuted + (r.parsed.absenceCheckStats?.refuted ?? 0),
      }), { absenceShaped: 0, identifierExtracted: 0, refuted: 0 }),
    },
    reviewedLineCount: results.reduce((sum, r) => sum + r.reviewedLineCount, 0),
    wasPromptTruncated: chunks.length < totalChunkCount || results.length < chunks.length,
    degraded: results.find((r) => r.degraded)?.degraded,
  };
}


async function reviewFileChunk(ctx: ModelReviewContext, params: {
  file: any;
  fileContext?: string | null;
  prTitle: string | null;
  prDescription: string | null;
  changelogExcerpt?: string | null;
  config: RepoConfig;
  totalLineCount: number;
  compactPrompt?: boolean;
  rejectedExemplars?: readonly RejectedExemplar[];
}) {
  const { systemPrompt, userPrompt } = buildFileReviewPrompts({
    ...params,
    file: params.file,
    config: params.config.review,
    rejectedExemplars: params.rejectedExemplars,
  });

  const outputBudgetTokens = reviewOutputBudgetTokens({
    findingCap: reviewBreadth(params.config.review),
    fileCount: 1,
  });

  const response = await runModelChain(ctx, {
    systemPrompt,
    userPrompt,
    responseSchema: buildReviewResponseSchema(reviewBreadth(params.config.review)),
    timeoutMs: adaptiveModelTimeoutMs(params.file.lineCount, outputBudgetTokens),
    outputBudgetTokens,
    // Partial output reads as "no findings left", not truncation; treat as untrusted.
    truncationIntolerant: true,
    label: params.file.path,
    totalLineCount: params.totalLineCount,
    config: params.config,
    parse: (rawText, { isLastModel }) => {
      const parsed = parseFileReviewResponse(rawText, params.file, {
        deniedClaimTypes: params.config.review.deny_claim_types,
        fileContent: params.fileContext,
      });

      // A one-sentence reply to a substantive diff means the model declined; escalate except on the last model, where failing beats an unearned clean.
      if (!isLastModel && isNonAnswerReview({
        rawText,
        file: params.file,
        findingCount: parsed.comments.length,
      })) {
        logger.warn('Model returned a non-answer for a substantive diff; escalating to the next model', {
          path: params.file.path,
          diffLineCount: params.file.lineCount,
          responseChars: rawText.trim().length,
        });
        throw new UnparseableModelResponseError(
          params.config.model?.main ?? 'unconfigured',
          `no findings and only ${rawText.trim().length} characters of response for a ${params.file.lineCount}-line diff`,
        );
      }

      return parsed;
    },
  });

  return {
    ...response,
    reviewedLineCount: params.file.lineCount,
    wasPromptTruncated: params.file.isTruncated === true,
  };
}

export type BatchReviewOutcome = ModelResponse & {
  batch: BatchReviewResult;
  userPrompt: string;
};

// Do not record batch.missing as reviewed.
export async function reviewFiles(ctx: ModelReviewContext, params: {
  files: readonly FileDiff[];
  prTitle: string | null;
  prDescription: string | null;
  changelogExcerpt?: string | null;
  config: RepoConfig;
  totalLineCount: number;
  rejectedExemplars?: readonly RejectedExemplar[];
}): Promise<BatchReviewOutcome> {
  const { systemPrompt, userPrompt } = buildBatchReviewPrompts({
    files: params.files,
    prTitle: params.prTitle,
    prDescription: params.prDescription,
    changelogExcerpt: params.changelogExcerpt,
    config: params.config.review,
    rejectedExemplars: params.rejectedExemplars,
  });

  // Bin's total lines; a small-file timeout on a 400-line bin kills the whole call.
  const binLineCount = params.files.reduce((sum, file) => sum + file.lineCount, 0);

  // Whole-bin response shares one maxOutputTokens (overrun leaves tail files looking falsely clean); same figure sizes the timeout since a packed bin is the slowest call.
  const outputBudgetTokens = reviewOutputBudgetTokens({
    findingCap: reviewBreadth(params.config.review),
    fileCount: params.files.length,
  });

  const response = await runModelChain(ctx, {
    systemPrompt,
    userPrompt,
    responseSchema: buildBatchReviewResponseSchema(reviewBreadth(params.config.review), params.files.length),
    timeoutMs: adaptiveModelTimeoutMs(binLineCount, outputBudgetTokens),
    outputBudgetTokens,
    truncationIntolerant: true,
    label: `${params.files.length} files (${params.files[0]?.path ?? 'unknown'} …)`,
    progressLabels: params.files.map((file) => file.path),
    totalLineCount: params.totalLineCount,
    config: params.config,
    parse: (rawText) => parseBatchReviewResponse(rawText, params.files, {
      deniedClaimTypes: params.config.review.deny_claim_types,
      maxCommentsPerFile: reviewBreadth(params.config.review),
    }),
  });

  return { ...response, batch: response.parsed };
}

