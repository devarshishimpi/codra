import { logger } from "../logger";
import type { RepoConfig } from "@codraoss/schema";
import type { FileDiff } from "../diff";
import { renderFileDiff, type RejectedExemplar } from "../prompts/file-review";
import type {
  BulkFileReviewInput,
  PullRequestRecord,
  ReviewModel,
  ReviewRuntime,
} from "../ports";
import { type PersistedReviewJob } from "./phase-control";
import {
  FRESH_INVOCATION_YIELD_SECONDS,
  MAX_RETRYABLE_FILE_REVIEW_FAILURES,
  MISSING_FILE_ERROR,
} from "../constants";
import {
  isSubrequestBudgetError,
  retryableModelFailureDelaySeconds,
} from "./retry-policy";
import { scanRuleChannel } from "./file-runner";

export function proportionalSplit(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];

  const sum = weights.reduce((a, b) => a + b, 0);
  const parts =
    sum <= 0
      ? weights.map(() => Math.floor(total / weights.length))
      : weights.map((w) => Math.floor((total * w) / sum));

  const assigned = parts.reduce((a, b) => a + b, 0);
  if (assigned < total) {
    const largest = weights.indexOf(Math.max(...weights));
    parts[largest === -1 ? 0 : largest] += total - assigned;
  }
  return parts;
}

export async function reviewAndPersistBin(
  env: ReviewRuntime,
  job: PersistedReviewJob,
  files: FileDiff[],
  pr: PullRequestRecord,
  config: RepoConfig,
  totalLineCount: number,
  model: ReviewModel,
  resolveFailureModelProvider: () => Promise<string | null>,
  rejectedExemplars: readonly RejectedExemplar[] = [],
  changelogExcerpt: string | null = null,
): Promise<number> {
  const startedAt = env.clock.now();

  const ruleScans = new Map(
    files.map((file) => [file.path, scanRuleChannel(file, config)]),
  );

  const persisted = new Set<string>();
  let terminalCount = 0;

  const failedRow = (
    file: FileDiff,
    errorMessage: string,
    modelProvider?: string | null,
  ): BulkFileReviewInput => ({
    filePath: file.path,
    fileStatus: "failed",
    modelUsed: config.model?.main ?? "unconfigured",
    modelProvider: modelProvider ?? null,
    diffLineCount: file.lineCount,
    rawAiOutput: null,
    parsedComments: ruleScans.get(file.path)?.comments ?? [],
    inputTokens: null,
    outputTokens: null,
    durationMs: env.clock.now() - startedAt,
    verdict: null,
    fileSummary: null,
    errorMessage,
    batchSize: files.length,
  });

  try {
    const response = await model.reviewFiles({
      files,
      prTitle: pr.title ?? null,
      prDescription: pr.body ?? null,
      changelogExcerpt,
      config,
      totalLineCount,
      rejectedExemplars,
    });

    const reviewed = files.filter((file) =>
      response.batch.reviews.has(file.path),
    );
    const weights = reviewed.map((file) => renderFileDiff(file).length);
    const inputSplit = proportionalSplit(response.inputTokens, weights);
    const outputSplit = proportionalSplit(response.outputTokens, weights);
    const durationMs = env.clock.now() - startedAt;

    const rows: BulkFileReviewInput[] = reviewed.map((file, index) => {
      const parsed = response.batch.reviews.get(file.path)!;
      const rules = ruleScans.get(file.path)!;
      return {
        filePath: file.path,
        fileStatus: "done",
        modelUsed: response.modelUsed,
        modelProvider: response.provider,
        diffLineCount: file.lineCount,
        rawAiOutput: response.rawText,
        parsedComments: [...parsed.comments, ...rules.comments],
        inputTokens: inputSplit[index],
        outputTokens: outputSplit[index],
        durationMs,
        verdict: parsed.verdict,
        fileSummary: parsed.fileSummary,
        overallCorrectness: parsed.overallCorrectness,
        confidenceScore: parsed.confidenceScore,
        errorMessage: null,
        withheldCounts: {
          evidence:
            (parsed.evidenceStats?.unmatched ?? 0) +
            (parsed.evidenceStats?.absent ?? 0) +
            (parsed.evidenceStats?.weak ?? 0),
          claimDenied: Object.values(parsed.deniedClaimCounts ?? {}).reduce(
            (sum, n) => sum + n,
            0,
          ),
          contextOnly: parsed.evidenceStats?.contextOnly ?? 0,
          absenceRefuted: parsed.absenceCheckStats?.refuted ?? 0,
        },
        // The whole bin shared one call, so every member inherits its degradation.
        degraded: response.degraded ?? null,
        batchSize: files.length,
      };
    });

    if (rows.length > 0) {
      await env.fileReviews.bulkUpsertFileReviews(job.id, rows);
      for (const row of rows) persisted.add(row.filePath);
      terminalCount += rows.length;
    }

    if (response.batch.missing.length > 0) {
      const counts =
        await env.fileReviews.bulkRecordRetryableFileReviewFailures(
          job.id,
          response.batch.missing.map((path) => ({
            filePath: path,
            modelUsed: response.modelUsed,
            diffLineCount: files.find((f) => f.path === path)?.lineCount ?? 0,
            errorMessage: MISSING_FILE_ERROR,
          })),
        );
      for (const count of counts) persisted.add(count.filePath);

      const exhausted = counts.filter(
        (c) => c.transientErrorCount >= MAX_RETRYABLE_FILE_REVIEW_FAILURES,
      );
      if (exhausted.length > 0) {
        await env.fileReviews.bulkUpsertFileReviews(
          job.id,
          exhausted.map((c) =>
            failedRow(
              files.find((f) => f.path === c.filePath)!,
              `Review skipped after the model omitted this file ${c.transientErrorCount} times.`,
            ),
          ),
        );
        terminalCount += exhausted.length;
      }
    }

    logger.info("Batched file review parsed", {
      jobId: job.id,
      model: response.modelUsed,
      binSize: files.length,
      binPaths: files.map((f) => f.path),
      binDiffLines: files.reduce((sum, f) => sum + f.lineCount, 0),
      durationMs,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      keptPerFile: rows.map((r) => ({
        path: r.filePath,
        kept: r.parsedComments.length,
      })),
      entriesReturned: response.batch.stats.entriesReturned,
      missingFiles: response.batch.missing,
      unroutableEntries: response.batch.stats.unroutableEntries,
      pathMismatchFindings: response.batch.stats.pathMismatchFindings,
      ambiguousAcrossBin: response.batch.stats.ambiguousAcrossBin,
      flatFallback: response.batch.stats.flatFallback,
      overCap: response.batch.stats.overCap,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown batched review error";
    const modelId = config.model?.main ?? "unconfigured";
    const modelProvider = await resolveFailureModelProvider();

    if (isSubrequestBudgetError(error)) {
      logger.warn(
        "Batched review deferred; subrequest budget will retry in a fresh invocation",
        {
          jobId: job.id,
          paths: files.map((f) => f.path),
          error: errorMessage,
        },
      );
      Object.defineProperty(error, "retryAfterSeconds", {
        value: FRESH_INVOCATION_YIELD_SECONDS,
        configurable: true,
      });
      throw error;
    }

    const outstanding = files.filter((file) => !persisted.has(file.path));

    if (outstanding.length === 0) {
      logger.warn(
        "Batched review hit an error after every file was persisted; keeping the committed rows",
        {
          jobId: job.id,
          paths: files.map((f) => f.path),
          error: errorMessage,
        },
      );
      return terminalCount;
    }

    if (env.modelErrors.isRetryableModelError(error)) {
      const advancedTo = env.modelErrors.nextChainIndexOf(error);
      const counts =
        await env.fileReviews.bulkRecordRetryableFileReviewFailures(
          job.id,
          outstanding.map((file) => ({
            filePath: file.path,
            modelUsed: modelId,
            diffLineCount: file.lineCount,
            errorMessage,
          })),
          { countsAsAttempt: advancedTo === null },
        );

      const exhausted = counts.filter(
        (c) => c.transientErrorCount >= MAX_RETRYABLE_FILE_REVIEW_FAILURES,
      );
      if (exhausted.length > 0) {
        await env.fileReviews.bulkUpsertFileReviews(
          job.id,
          exhausted.map((c) =>
            failedRow(
              files.find((f) => f.path === c.filePath)!,
              `Review skipped after ${c.transientErrorCount} repeated model provider outages.`,
              modelProvider,
            ),
          ),
        );
        terminalCount += exhausted.length;
        logger.error(
          "Files in a batched review failed permanently after transient retries",
          {
            jobId: job.id,
            paths: exhausted.map((c) => c.filePath),
            error: errorMessage,
          },
        );
      }

      const stillRetrying = counts.filter(
        (c) => c.transientErrorCount < MAX_RETRYABLE_FILE_REVIEW_FAILURES,
      );
      if (stillRetrying.length === 0) return terminalCount;

      logger.warn(
        "Batched review deferred; transient model/provider failure will retry later",
        {
          jobId: job.id,
          paths: stillRetrying.map((c) => c.filePath),
          error: errorMessage,
        },
      );
      Object.defineProperty(error, "retryAfterSeconds", {
        value: retryableModelFailureDelaySeconds(
          Math.max(...stillRetrying.map((c) => c.transientErrorCount)),
        ),
        configurable: true,
      });
      throw error;
    }

    logger.error("Batched review failed", {
      jobId: job.id,
      paths: outstanding.map((f) => f.path),
      error,
    });

    await env.fileReviews.bulkUpsertFileReviews(
      job.id,
      outstanding.map((file) => failedRow(file, errorMessage, modelProvider)),
    );
    terminalCount += outstanding.length;
  }

  return terminalCount;
}
