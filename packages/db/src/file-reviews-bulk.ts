import type { DbEnv } from "./env";
import type { BulkFileReviewInput } from "@codraoss/core/ports";
import { queryRows, queryTransaction } from "./client";
import {
  REVIEW_COMMENT_INSERT_CASTS,
  REVIEW_COMMENT_INSERT_COLUMNS,
  reviewCommentInsertValues,
} from "./review-comment-sql";

// `filePaths` must already be filtered to inheritable files with no row yet in the target job.
export async function bulkInheritFileReviews(
  env: DbEnv,
  input: { jobId: string; parentJobId: string; filePaths: string[] },
): Promise<string[]> {
  if (input.filePaths.length === 0) return [];

  return await queryTransaction(env, async (tx) => {
    const inserted = await tx.query<{ id: string; file_path: string }>(
      `
        INSERT INTO file_reviews (
          job_id, file_path, file_status, model_used, diff_line_count, diff_input,
          raw_ai_output, input_tokens, output_tokens, duration_ms, verdict,
          file_summary, overall_correctness, confidence_score, error_msg, model_provider,
          -- Carried, not defaulted: an inheriting job reading 0 here approves the PR silently.
          withheld_counts,
          -- Carried too, or every inherited row looks pre-batching.
          batch_size,
          -- An inherited row is the SAME review; hiding that it ran degraded would be a fresh lie.
          degraded
        )
        SELECT $1::uuid, file_path, file_status, model_used, diff_line_count, diff_input,
          raw_ai_output, input_tokens, output_tokens, duration_ms, verdict,
          file_summary, overall_correctness, confidence_score, error_msg, model_provider,
          withheld_counts, batch_size, degraded
        FROM file_reviews
        WHERE job_id = $2::uuid AND file_status = 'done' AND file_path = ANY($3::text[])
        ON CONFLICT (job_id, file_path) DO NOTHING
        RETURNING id, file_path
      `,
      [input.jobId, input.parentJobId, input.filePaths],
    );

    if (inserted.length > 0) {
      // Re-attach the comments by path; `posted` resets since an inheriting job hasn't shown it on GitHub.
      await tx.query(
        `
          INSERT INTO review_comments (
            file_review_id, path, line, position, severity, category, title, body, code_suggestion, confidence_score,
            evidence, fingerprint, anchor_hash, posted, claim_type, context_snippet, disposition, fingerprint_v2,
            source, rule_id, reviewer_model
          )
          SELECT nw.new_id, rc.path, rc.line, rc.position, rc.severity, rc.category, rc.title, rc.body, rc.code_suggestion, rc.confidence_score,
                 rc.evidence, rc.fingerprint, rc.anchor_hash, FALSE, rc.claim_type, rc.context_snippet, NULL, rc.fingerprint_v2,
                 -- Carried, or a retried job's rule findings become LLM findings.
                 rc.source, rc.rule_id, rc.reviewer_model
          FROM UNNEST($1::uuid[], $2::text[]) AS nw(new_id, file_path)
          JOIN file_reviews pf ON pf.job_id = $3::uuid AND pf.file_path = nw.file_path
          JOIN review_comments rc ON rc.file_review_id = pf.id
        `,
        [
          inserted.map((r) => r.id),
          inserted.map((r) => r.file_path),
          input.parentJobId,
        ],
      );
    }

    return inserted.map((r) => r.file_path);
  });
}

export type { BulkFileReviewInput } from "@codraoss/core/ports";

// One transaction: per-file upserts would spend the saved model calls back on DB subrequests. `diff_input` is not written (migration 003 nulls it).
export async function bulkUpsertFileReviews(
  env: DbEnv,
  jobId: string,
  inputs: BulkFileReviewInput[],
): Promise<void> {
  if (inputs.length === 0) return;

  await queryTransaction(env, async (tx) => {
    const inserted = await tx.query<{ id: string; file_path: string }>(
      `
        INSERT INTO file_reviews (
          job_id, file_path, file_status, model_used, diff_line_count, diff_input,
          raw_ai_output, input_tokens, output_tokens, duration_ms, verdict,
          file_summary, overall_correctness, confidence_score, error_msg, model_provider,
          withheld_counts, degraded, batch_size
        )
        SELECT $1::uuid, u.file_path, u.file_status, u.model_used, u.diff_line_count, NULL,
          u.raw_ai_output, u.input_tokens, u.output_tokens, u.duration_ms, u.verdict,
          u.file_summary, u.overall_correctness, u.confidence_score, u.error_msg, u.model_provider,
          -- Matches upsertFileReview's '::text::jsonb' idiom; mixing idioms is how the string-scalar bug spread across five columns.
          u.withheld_counts::jsonb, u.degraded, u.batch_size
        FROM UNNEST(
          $2::text[], $3::text[], $4::text[], $5::int[], $6::text[], $7::int[], $8::int[], $9::int[],
          $10::text[], $11::text[], $12::text[], $13::real[], $14::text[], $15::text[], $16::text[], $17::text[], $18::int[]
        ) AS u(
          file_path, file_status, model_used, diff_line_count, raw_ai_output, input_tokens,
          output_tokens, duration_ms, verdict, file_summary, overall_correctness, confidence_score,
          error_msg, model_provider, withheld_counts, degraded, batch_size
        )
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
          withheld_counts = EXCLUDED.withheld_counts,
          degraded = EXCLUDED.degraded,
          batch_size = EXCLUDED.batch_size,
          -- A terminal review supersedes any in-flight async submission, matching upsertFileReview.
          async_request_id = NULL,
          async_model = NULL,
          transient_error_count = 0
        RETURNING id, file_path
      `,
      (() => {
        const res: any[] = [
          jobId,
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
          [],
        ];
        for (const i of inputs) {
          res[1].push(i.filePath);
          res[2].push(i.fileStatus);
          res[3].push(i.modelUsed);
          res[4].push(i.diffLineCount);
          res[5].push(i.rawAiOutput);
          res[6].push(i.inputTokens);
          res[7].push(i.outputTokens);
          res[8].push(i.durationMs);
          res[9].push(i.verdict);
          res[10].push(i.fileSummary);
          res[11].push(i.overallCorrectness ?? null);
          res[12].push(i.confidenceScore ?? null);
          res[13].push(i.errorMessage);
          res[14].push(i.modelProvider ?? null);
          res[15].push(
            i.withheldCounts ? JSON.stringify(i.withheldCounts) : null,
          );
          res[16].push(i.degraded ?? null);
          res[17].push(i.batchSize);
        }
        return res;
      })(),
    );

    await tx.query(
      "DELETE FROM review_comments WHERE file_review_id = ANY($1::uuid[])",
      [inserted.map((r) => r.id)],
    );

    // Keyed by file_path, not position: RETURNING order isn't guaranteed to match input order.
    const idByPath = new Map(inserted.map((r) => [r.file_path, r.id]));
    const withComments = inputs.filter(
      (i) => i.parsedComments.length > 0 && idByPath.has(i.filePath),
    );
    if (withComments.length === 0) return;

    const flattened = withComments.flatMap((i) => i.parsedComments);
    const reviewIds = withComments.flatMap((i) =>
      i.parsedComments.map(() => idByPath.get(i.filePath)!),
    );

    await tx.query(
      `
        INSERT INTO review_comments (file_review_id, ${REVIEW_COMMENT_INSERT_COLUMNS.join(", ")})
        SELECT * FROM UNNEST($1::uuid[], ${REVIEW_COMMENT_INSERT_CASTS})
      `,
      [reviewIds, ...reviewCommentInsertValues(flattened)],
    );
  });
}

// One statement, returning each file's new attempt count so the caller can fail exhausted ones.
export async function bulkRecordRetryableFileReviewFailures(
  env: DbEnv,
  jobId: string,
  inputs: Array<{
    filePath: string;
    modelUsed: string;
    diffLineCount: number;
    errorMessage: string;
  }>,
  // False when the model chain advanced: the retry resumes at the next model, so this deferral is
  // progress rather than a repeated outage and must not spend one of the three allowed attempts.
  // Bin-wide because a bin shares one chain walk. See model-chain-progress.ts.
  opts: { countsAsAttempt?: boolean } = {},
): Promise<Array<{ filePath: string; transientErrorCount: number }>> {
  if (inputs.length === 0) return [];

  return await queryTransaction(env, async (tx) => {
    const rows = await tx.query<{
      id: string;
      file_path: string;
      transient_error_count: number;
    }>(
      `
        INSERT INTO file_reviews (
          job_id, file_path, file_status, model_used, diff_line_count, diff_input, error_msg,
          duration_ms, transient_error_count
        )
        SELECT $1::uuid, u.file_path, 'failed', u.model_used, u.diff_line_count, NULL, u.error_msg, 0, $6::int
        FROM UNNEST($2::text[], $3::text[], $4::int[], $5::text[])
          AS u(file_path, model_used, diff_line_count, error_msg)
        ON CONFLICT (job_id, file_path) DO UPDATE SET
          file_status = 'failed',
          model_used = EXCLUDED.model_used,
          diff_line_count = EXCLUDED.diff_line_count,
          -- Cleared to parity with recordRetryableFileReviewFailure.
          raw_ai_output = NULL,
          input_tokens = NULL,
          output_tokens = NULL,
          verdict = NULL,
          file_summary = NULL,
          overall_correctness = NULL,
          confidence_score = NULL,
          -- Also cleared, unlike the single-file version: gate-pipeline sums this unfiltered.
          withheld_counts = NULL,
          degraded = NULL,
          error_msg = EXCLUDED.error_msg,
          transient_error_count = file_reviews.transient_error_count + $6::int
        RETURNING id, file_path, transient_error_count
      `,
      [
        jobId,
        inputs.map((i) => i.filePath),
        inputs.map((i) => i.modelUsed),
        inputs.map((i) => i.diffLineCount),
        inputs.map((i) => i.errorMessage),
        opts.countsAsAttempt === false ? 0 : 1,
      ],
    );

    // Stale comments would let finalize post findings from a review since marked failed.
    await tx.query(
      "DELETE FROM review_comments WHERE file_review_id = ANY($1::uuid[])",
      [rows.map((r) => r.id)],
    );

    return rows.map((r) => ({
      filePath: r.file_path,
      transientErrorCount: Number(r.transient_error_count),
    }));
  });
}

// One INSERT, so finalize's backfill cannot blow the subrequest budget right before posting; `ON CONFLICT DO NOTHING` so it never clobbers a real review.
export async function bulkMarkFilesFailed(
  env: DbEnv,
  jobId: string,
  files: Array<{ filePath: string; diffLineCount: number }>,
  opts: { modelUsed: string; errorMessage: string },
): Promise<void> {
  if (files.length === 0) return;
  await queryRows(
    env,
    `
      INSERT INTO file_reviews (job_id, file_path, file_status, model_used, diff_line_count, diff_input, error_msg, duration_ms)
      SELECT $1::uuid, u.file_path, 'failed', $2, u.diff_line_count, NULL, $3, 0
      FROM UNNEST($4::text[], $5::int[]) AS u(file_path, diff_line_count)
      ON CONFLICT (job_id, file_path) DO NOTHING
    `,
    [
      jobId,
      opts.modelUsed,
      opts.errorMessage,
      files.map((f) => f.filePath),
      files.map((f) => f.diffLineCount),
    ],
  );
}
