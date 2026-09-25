import type { DbEnv } from "./env";
import { queryRows } from "./client";
import type { JobRow } from "./jobs-mapping";
import { markSystemActive } from "./jobs-activity";

export async function updateJobCheckRun(
  env: DbEnv,
  jobId: string,
  checkRunId: number,
) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET check_run_id = $2
      WHERE id = $1
    `,
    [jobId, checkRunId],
  );
}

export async function completeJob(
  env: DbEnv,
  jobId: string,
  input: {
    verdict: "approve" | "comment";
    fileCount: number;
    commentCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    summaryMarkdown: string;
    reviewId: number | null;
    summaryModel: string | null;
    overallConfidenceScore?: number | null;
    errorMessage?: string | null;
  },
) {
  const now = new Date().toISOString();
  await queryRows(
    env,
    `
      UPDATE jobs
      SET status = 'done',
          finished_at = now(),
          -- check_run_completed_at is intentionally NOT set here -- only once markJobCheckRunCompleted confirms GitHub's check run actually updated; otherwise completeTerminalCheckRuns reconciles it later.
          lease_owner = NULL,
          lease_expires_at = NULL,
          verdict = $2,
          file_count = $3,
          comment_count = $4,
          total_input_tokens = $5,
          total_output_tokens = $6,
          summary_markdown = $7,
          review_id = $8,
          summary_model = $9,
          overall_confidence_score = $10,
          error_msg = $11,
          steps = CASE
            WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(steps, '[]'::jsonb)) s WHERE s->>'name' = 'Completing')
            THEN (
              SELECT jsonb_agg(
                CASE
                  WHEN s->>'name' = 'Completing'
                  THEN s || jsonb_build_object('status', 'done', 'finishedAt', $12::text, 'error', NULL)
                  ELSE s
                END
              ) FROM jsonb_array_elements(COALESCE(steps, '[]'::jsonb)) s
            )
            ELSE COALESCE(steps, '[]'::jsonb) || jsonb_build_array(
              jsonb_build_object(
                'name', 'Completing',
                'status', 'done',
                'startedAt', $12::text,
                'finishedAt', $12::text,
                'error', NULL
              )
            )
          END
      WHERE id = $1
    `,
    [
      jobId,
      input.verdict,
      input.fileCount,
      input.commentCount,
      input.totalInputTokens,
      input.totalOutputTokens,
      input.summaryMarkdown,
      input.reviewId,
      input.summaryModel,
      input.overallConfidenceScore ?? null,
      input.errorMessage ?? null,
      now,
    ],
  );
}

export async function failJob(
  env: Pick<DbEnv, "HYPERDRIVE" | "APP_KV">,
  jobId: string,
  errorMessage: string,
) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET status = 'failed',
          finished_at = now(),
          lease_owner = NULL,
          lease_expires_at = NULL,
          error_msg = $2,
          steps = CASE
            WHEN steps IS NOT NULL THEN (
              SELECT jsonb_agg(
                CASE
                  WHEN s->>'status' = 'running'
                  THEN s || jsonb_build_object('status', 'failed', 'finishedAt', now(), 'error', $2::text)
                  ELSE s
                END
              ) FROM jsonb_array_elements(steps) s
            )
            ELSE steps
          END
      WHERE id = $1
    `,
    [jobId, errorMessage],
  );
  await markSystemActive(env);
}

// Clears lease. Returns false if terminal (caller must terminate Workflow).
export async function cancelJob(
  env: Pick<DbEnv, "HYPERDRIVE" | "APP_KV">,
  jobId: string,
): Promise<boolean> {
  const rows = await queryRows<{ id: string }>(
    env,
    `
      UPDATE jobs
      SET status = 'cancelled',
          finished_at = now(),
          lease_owner = NULL,
          lease_expires_at = NULL,
          error_msg = COALESCE(error_msg, 'Stopped by user.'),
          steps = CASE
            WHEN steps IS NOT NULL THEN (
              SELECT jsonb_agg(
                CASE
                  WHEN s->>'status' = 'running'
                  THEN s || jsonb_build_object('status', 'failed', 'finishedAt', now(), 'error', 'Stopped by user.')
                  ELSE s
                END
              ) FROM jsonb_array_elements(steps) s
            )
            ELSE steps
          END
      WHERE id = $1 AND status IN ('queued', 'running')
      RETURNING id
    `,
    [jobId],
  );
  // Keep the maintenance flag set so the cron completes the GitHub check run for the cancelled job.
  if (rows.length > 0) await markSystemActive(env);
  return rows.length > 0;
}

// review_comments cascade; child retries have retry_of_job_id nulled.
export async function deleteJob(env: DbEnv, jobId: string): Promise<boolean> {
  const rows = await queryRows<{ id: string }>(
    env,
    `DELETE FROM jobs WHERE id = $1 RETURNING id`,
    [jobId],
  );
  return rows.length > 0;
}

export async function markJobCheckRunCompleted(env: DbEnv, jobId: string) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET check_run_completed_at = now()
      WHERE id = $1
    `,
    [jobId],
  );
}

export async function updateJobFileCount(
  env: DbEnv,
  jobId: string,
  fileCount: number,
) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET file_count = $2
      WHERE id = $1
    `,
    [jobId, fileCount],
  );
}

export async function completePreparationStep(
  env: DbEnv,
  jobId: string,
  fileCount: number,
) {
  const now = new Date().toISOString();
  await queryRows(
    env,
    `
      UPDATE jobs
      SET file_count = $2,
          steps = (
            SELECT jsonb_agg(
              CASE
                WHEN s->>'name' = 'Preparation'
                THEN s || jsonb_build_object('status', 'done', 'finishedAt', $3::text)
                ELSE s
              END
            ) FROM jsonb_array_elements(steps) s
          )
      WHERE id = $1
    `,
    [jobId, fileCount, now],
  );
}

export async function updateJobStep(
  env: DbEnv,
  jobId: string,
  stepName: string,
  update: {
    status: "pending" | "running" | "done" | "failed";
    startedAt?: string | null;
    finishedAt?: string | null;
    error?: string | null;
  },
) {
  const now = new Date().toISOString();
  const startedAt =
    update.status === "running" ? now : (update.startedAt ?? null);
  const finishedAt =
    update.status === "done" || update.status === "failed"
      ? now
      : (update.finishedAt ?? null);
  const error = update.error ?? null;

  await queryRows(
    env,
    `
      UPDATE jobs
      SET heartbeat_at = now(),
          steps = CASE
        WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(steps, '[]'::jsonb)) s WHERE s->>'name' = $2)
        THEN (
          SELECT jsonb_agg(
            CASE
              WHEN s->>'name' = $2
              THEN s || jsonb_build_object(
                'status', $3::text,
                -- Preserve the FIRST start time: a phase re-enters 'running' once per hibernated chunk, so seed it only when absent to keep the true multi-minute wall-clock.
                'startedAt', COALESCE(s->>'startedAt', $4::text),
                -- 'running' clears any stale finish; otherwise keep the FIRST finish so re-marking 'done' doesn't inflate the displayed duration.
                'finishedAt', CASE WHEN $3::text = 'running' THEN NULL ELSE COALESCE(s->>'finishedAt', $5::text) END,
                'error', COALESCE($6::text, s->>'error')
              )
              ELSE s
            END
          ) FROM jsonb_array_elements(COALESCE(steps, '[]'::jsonb)) s
        )
        ELSE COALESCE(steps, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object(
            'name', $2::text,
            'status', $3::text,
            'startedAt', $4::text,
            'finishedAt', $5::text,
            'error', $6::text
          )
        )
      END
      WHERE id = $1
    `,
    [jobId, stepName, update.status, startedAt, finishedAt, error],
  );
}

export async function getTerminalJobsNeedingCheckRunCompletion(
  env: DbEnv,
  limit = 25,
) {
  return queryRows<JobRow>(
    env,
    `
      SELECT j.*, r.owner, r.repo, r.installation_id
      FROM jobs j
      JOIN repositories r ON j.repository_id = r.id
      WHERE j.status IN ('done', 'failed', 'superseded', 'cancelled')
        AND j.check_run_id IS NOT NULL
        AND j.check_run_completed_at IS NULL
      ORDER BY COALESCE(j.finished_at, j.started_at, j.created_at) ASC
      LIMIT $1
    `,
    [limit],
  );
}

export async function supersedeOlderJobs(
  env: DbEnv,
  input: {
    installationId: string;
    owner: string;
    repo: string;
    prNumber: number;
    newJobId: string;
  },
): Promise<number> {
  const rows = await queryRows<{ id: string }>(
    env,
    `
      UPDATE jobs j
      SET status = 'superseded',
          finished_at = now(),
          lease_owner = NULL,
          lease_expires_at = NULL,
          error_msg = 'Superseded by a newer commit or job.'
      FROM repositories r
      WHERE j.repository_id = r.id
        AND r.installation_id = $1
        AND r.owner = $2
        AND r.repo = $3
        AND j.pr_number = $4
        AND j.id != $5
        AND j.status IN ('queued', 'running')
      RETURNING j.id
    `,
    [
      input.installationId,
      input.owner,
      input.repo,
      input.prNumber,
      input.newJobId,
    ],
  );

  return rows.length;
}
