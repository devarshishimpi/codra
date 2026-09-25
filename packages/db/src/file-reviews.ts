import type { DbEnv } from "./env";
import type { ParsedReviewComment } from "@codraoss/schema";

import { parseJsonColumn, queryRows, queryTransaction } from "./client";
import {
  REVIEW_COMMENT_INSERT_CASTS,
  REVIEW_COMMENT_INSERT_COLUMNS,
  reviewCommentInsertValues,
  reviewCommentsAggregate,
} from "./review-comment-sql";
import {
  type SuppressedFinding,
  getSuppressedFindings,
  getFindingLabelTarget,
  markCommentsPosted,
  markCommentDispositions,
} from "./file-reviews-findings";
import {
  type BulkFileReviewInput,
  bulkInheritFileReviews,
  bulkMarkFilesFailed,
  bulkRecordRetryableFileReviewFailures,
  bulkUpsertFileReviews,
} from "./file-reviews-bulk";

export {
  type SuppressedFinding,
  getSuppressedFindings,
  getFindingLabelTarget,
  markCommentsPosted,
  markCommentDispositions,
};

// Multi-file writers live in their own module (max-lines); callers still import them from here.
export {
  type BulkFileReviewInput,
  bulkInheritFileReviews,
  bulkMarkFilesFailed,
  bulkRecordRetryableFileReviewFailures,
  bulkUpsertFileReviews,
};

export async function upsertFileReview(
  env: DbEnv,
  jobId: string,
  input: {
    filePath: string;
    fileStatus: "pending" | "done" | "skipped" | "failed";
    modelUsed: string;
    modelProvider?: string | null;
    diffLineCount: number;
    diffInput: string | null;
    rawAiOutput: string | null;
    parsedComments: ParsedReviewComment[];
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    verdict: "approve" | "comment" | null;
    fileSummary: string | null;
    overallCorrectness?: string | null;
    confidenceScore?: number | null;
    errorMessage: string | null;
    // Findings dropped in the PARSER have no review_comments row to carry a disposition; without this, "everything was withheld" is indistinguishable from clean.
    withheldCounts?: {
      evidence: number;
      claimDenied: number;
      contextOnly?: number;
      absenceRefuted?: number;
    } | null;
    // The call answered, but not cleanly: it ran without a response grammar, or its output was cut off
    // and salvaged. Persisted rather than logged so "how often did this happen" is a query.
    degraded?: string | null;
    // Async batch bookkeeping: set on submit to the Workers AI queue, cleared once the batch completes.
    asyncRequestId?: string | null;
    asyncModel?: string | null;
  },
) {
  await queryTransaction(env, async (tx) => {
    const [review] = await tx.query<{ id: string }>(
      `
        INSERT INTO file_reviews (
          job_id,
          file_path,
          file_status,
          model_used,
          diff_line_count,
          diff_input,
          raw_ai_output,
          input_tokens,
          output_tokens,
          duration_ms,
          verdict,
          file_summary,
          overall_correctness,
          confidence_score,
          error_msg,
          model_provider,
          async_request_id,
          async_model,
          withheld_counts,
          degraded,
          batch_size
        )
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::text::jsonb, $20, 1)
        ON CONFLICT (job_id, file_path) DO UPDATE SET
          file_status = EXCLUDED.file_status,
          model_used = EXCLUDED.model_used,
          diff_line_count = EXCLUDED.diff_line_count,
          diff_input = EXCLUDED.diff_input,
          raw_ai_output = EXCLUDED.raw_ai_output,
          input_tokens = EXCLUDED.input_tokens,
          output_tokens = EXCLUDED.output_tokens,
          duration_ms = EXCLUDED.duration_ms,
          verdict = EXCLUDED.verdict,
          file_summary = EXCLUDED.file_summary,
          overall_correctness = EXCLUDED.overall_correctness,
          confidence_score = EXCLUDED.confidence_score,
          error_msg = EXCLUDED.error_msg,
          model_provider = EXCLUDED.model_provider,
          async_request_id = EXCLUDED.async_request_id,
          async_model = EXCLUDED.async_model,
          withheld_counts = EXCLUDED.withheld_counts,
          degraded = EXCLUDED.degraded,
          batch_size = EXCLUDED.batch_size,
          transient_error_count = 0
        RETURNING id
      `,
      [
        jobId,
        input.filePath,
        input.fileStatus,
        input.modelUsed,
        input.diffLineCount,
        input.diffInput,
        input.rawAiOutput,
        input.inputTokens,
        input.outputTokens,
        input.durationMs,
        input.verdict,
        input.fileSummary,
        input.overallCorrectness ?? null,
        input.confidenceScore ?? null,
        input.errorMessage,
        input.modelProvider ?? null,
        input.asyncRequestId ?? null,
        input.asyncModel ?? null,
        // JSON text to ::text::jsonb placeholder prevents string-scalar bugs.
        input.withheldCounts ? JSON.stringify(input.withheldCounts) : null,
        input.degraded ?? null,
      ],
    );

    await tx.query(
      "DELETE FROM review_comments WHERE file_review_id = $1::uuid",
      [review.id],
    );

    if (input.parsedComments.length > 0) {
      await tx.query(
        `
          INSERT INTO review_comments (file_review_id, ${REVIEW_COMMENT_INSERT_COLUMNS.join(", ")})
          SELECT $1::uuid, * FROM UNNEST(${REVIEW_COMMENT_INSERT_CASTS})
        `,
        [review.id, ...reviewCommentInsertValues(input.parsedComments)],
      );
    }
  });
}

export async function recordRetryableFileReviewFailure(
  env: DbEnv,
  jobId: string,
  input: {
    filePath: string;
    modelUsed: string;
    modelProvider?: string | null;
    diffLineCount: number;
    diffInput: string | null;
    durationMs: number | null;
    errorMessage: string;
    // False while the model chain still has untried entries: the deferral made progress (the next
    // attempt resumes further down the chain), so it is not evidence of a repeated outage and must
    // not spend one of MAX_RETRYABLE_FILE_REVIEW_FAILURES.
    countsAsAttempt?: boolean;
  },
) {
  return await queryTransaction(env, async (tx) => {
    const [review] = await tx.query<{
      id: string;
      transient_error_count: number;
    }>(
      `
        INSERT INTO file_reviews (
          job_id,
          file_path,
          file_status,
          model_used,
          model_provider,
          diff_line_count,
          diff_input,
          raw_ai_output,
          input_tokens,
          output_tokens,
          duration_ms,
          verdict,
          file_summary,
          overall_correctness,
          confidence_score,
          error_msg,
          transient_error_count
        )
        VALUES ($1::uuid, $2, 'failed', $3, $4, $5, $6, NULL, NULL, NULL, $7, NULL, NULL, NULL, NULL, $8, $9::int)
        ON CONFLICT (job_id, file_path) DO UPDATE SET
          file_status = 'failed',
          model_used = EXCLUDED.model_used,
          model_provider = EXCLUDED.model_provider,
          diff_line_count = EXCLUDED.diff_line_count,
          diff_input = EXCLUDED.diff_input,
          raw_ai_output = NULL,
          input_tokens = NULL,
          output_tokens = NULL,
          duration_ms = EXCLUDED.duration_ms,
          verdict = NULL,
          file_summary = NULL,
          overall_correctness = NULL,
          confidence_score = NULL,
          error_msg = EXCLUDED.error_msg,
          transient_error_count = file_reviews.transient_error_count + $9::int
        RETURNING id, transient_error_count
      `,
      [
        jobId,
        input.filePath,
        input.modelUsed,
        input.modelProvider ?? null,
        input.diffLineCount,
        input.diffInput,
        input.durationMs,
        input.errorMessage,
        input.countsAsAttempt === false ? 0 : 1,
      ],
    );

    await tx.query(
      "DELETE FROM review_comments WHERE file_review_id = $1::uuid",
      [review.id],
    );
    return review.transient_error_count;
  });
}

export async function getModelUsageStats(env: DbEnv, days: number) {
  return queryRows<{
    model_used: string;
    model_provider: string | null;
    calls: number;
    input_tokens: number | null;
    output_tokens: number | null;
  }>(
    env,
    `
      SELECT
        model_used,
        MIN(model_provider) AS model_provider,
        COUNT(*)::int AS calls,
        COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS output_tokens
      FROM file_reviews
      WHERE created_at >= now() - ($1::int * interval '1 day')
      GROUP BY model_used
      ORDER BY calls DESC, model_used ASC
      LIMIT 20
    `,
    [days],
  );
}

export async function getFileReviewsForJobs(env: DbEnv, jobIds: string[]) {
  if (jobIds.length === 0) return [];

  const rows = await queryRows<{
    id: string;
    job_id: string;
    file_path: string;
    file_status: "pending" | "done" | "skipped" | "failed";
    model_used: string;
    diff_line_count: number;
    diff_input: string | null;
    raw_ai_output: string | null;
    parsed_comments: ParsedReviewComment[] | string;
    input_tokens: number | null;
    output_tokens: number | null;
    duration_ms: number | null;
    verdict: "approve" | "comment" | null;
    file_summary: string | null;
    overall_correctness: string | null;
    confidence_score: number | null;
    error_msg: string | null;
    model_provider: string | null;
    transient_error_count: number;
    async_request_id: string | null;
    async_model: string | null;
    withheld_counts:
      { evidence?: number; claimDenied?: number } | string | null;
    // NULL pre-batching; 1 reviewed alone, N for a packed bin.
    batch_size: number | null;
  }>(
    env,
    `
      SELECT
        fr.*,
        ${reviewCommentsAggregate()} AS parsed_comments
      FROM file_reviews fr
      WHERE fr.job_id = ANY($1::uuid[])
      ORDER BY fr.created_at ASC
    `,
    [jobIds],
  );

  return rows.map((row) => ({
    ...row,
    parsed_comments: parseJsonColumn(row.parsed_comments, []),
    withheld_counts: parseJsonColumn(
      row.withheld_counts,
      {} as { evidence?: number; claimDenied?: number },
    ),
  }));
}
