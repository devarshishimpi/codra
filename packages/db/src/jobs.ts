import type { DbEnv } from "./env";
import { hexToBytes } from "@codraoss/schema/hex";
import { parseJsonColumn, queryRows } from "./client";
import {
  defaultRepoConfig,
  jobDetailSchema,
  repoConfigSchema,
  type RepoConfig,
} from "@codraoss/schema";
import { getOrCreateRepository } from "./repositories";
import { reviewCommentJsonObject } from "./review-comment-sql";
import { type JobRow, bytesToHex, mapJob } from "./jobs-mapping";
import { markSystemActive } from "./jobs-activity";

type JobDetailRow = JobRow & {
  files_json: unknown[] | string | null;
};

export async function setJobWorkflowInstance(
  env: DbEnv,
  jobId: string,
  workflowInstanceId: string,
) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET workflow_instance_id = $2::uuid
      WHERE id = $1
    `,
    [jobId, workflowInstanceId],
  );
}

// Snapshotted values; prevents stale dashboard if PR title changes.
export async function setJobPullRequestMeta(
  env: DbEnv,
  jobId: string,
  meta: { prTitle: string | null; prAuthor: string | null },
) {
  await queryRows(
    env,
    `
      UPDATE jobs
      SET pr_title = $2,
          pr_author = COALESCE($3, pr_author)
      WHERE id = $1
    `,
    [jobId, meta.prTitle, meta.prAuthor],
  );
}

// False allows cron to clear SYSTEM_ACTIVE_JOBS_KEY.
export async function hasPendingMaintenanceWork(env: DbEnv): Promise<boolean> {
  const rows = await queryRows<{ has_work: boolean }>(
    env,
    `
      SELECT EXISTS (
        SELECT 1 FROM jobs
        WHERE status IN ('queued', 'running')
           OR (status IN ('done', 'failed', 'superseded', 'cancelled') AND check_run_id IS NOT NULL AND check_run_completed_at IS NULL)
      ) AS has_work
    `,
  );
  return rows[0]?.has_work === true;
}

export async function insertJob(
  env: Pick<DbEnv, "HYPERDRIVE" | "APP_KV">,
  input: {
    installationId: string;
    owner: string;
    repo: string;
    prNumber: number;
    prTitle: string | null;
    prAuthor: string | null;
    commitSha: string;
    baseSha: string;
    trigger: "auto" | "mention" | "retry";
    headRef: string | null;
    baseRef: string | null;
    configSnapshot?: RepoConfig | null;
    retryOfJobId?: string | null;
  },
) {
  const repositoryId = await getOrCreateRepository(env, {
    installationId: input.installationId,
    owner: input.owner,
    repo: input.repo,
  });

  const [row] = await queryRows<JobRow>(
    env,
    `
      WITH inserted AS (
        INSERT INTO jobs (
          repository_id,
          pr_number,
          pr_title,
          pr_author,
          commit_sha,
          base_sha,
          trigger,
          status,
          config_snapshot,
          head_ref,
          base_ref,
          retry_of_job_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8::text::jsonb, $9, $10, $11::uuid)
        RETURNING *
      )
      SELECT i.*, r.owner, r.repo, r.installation_id
      FROM inserted i
      JOIN repositories r ON i.repository_id = r.id
    `,
    [
      repositoryId,
      input.prNumber,
      input.prTitle,
      input.prAuthor,
      hexToBytes(input.commitSha),
      hexToBytes(input.baseSha),
      input.trigger,
      JSON.stringify(input.configSnapshot ?? defaultRepoConfig),
      input.headRef,
      input.baseRef,
      input.retryOfJobId ?? null,
    ],
  );

  await markSystemActive(env);
  return mapJob(row);
}

export async function listJobs(
  env: DbEnv,
  query: {
    owner?: string;
    repo?: string;
    prNumber?: number;
    status?: string;
    verdict?: string;
    search?: string;
    limit: number;
    offset: number;
  },
) {
  const conditions: string[] = [];
  const params: any[] = [];

  if (query.owner) {
    params.push(query.owner);
    conditions.push(`r.owner = $${params.length}`);
  }
  if (query.repo) {
    params.push(query.repo);
    conditions.push(`r.repo = $${params.length}`);
  }
  if (query.prNumber) {
    params.push(query.prNumber);
    conditions.push(`j.pr_number = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    conditions.push(`j.status = $${params.length}`);
  }
  if (query.verdict) {
    params.push(query.verdict);
    conditions.push(`j.verdict = $${params.length}`);
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    conditions.push(
      `(j.pr_title ILIKE $${params.length} OR CAST(j.pr_number AS TEXT) LIKE $${params.length})`,
    );
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(query.limit);
  const limitIdx = params.length;
  params.push(query.offset);
  const offsetIdx = params.length;

  const [rows, [totalResult]] = await Promise.all([
    queryRows<JobRow>(
      env,
      `
        SELECT j.*, r.owner, r.repo, r.installation_id
        FROM jobs j
        JOIN repositories r ON j.repository_id = r.id
        ${whereClause}
        ORDER BY j.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      params,
    ),
    queryRows<{ count: string }>(
      env,
      `
        SELECT COUNT(*) as count
        FROM jobs j
        JOIN repositories r ON j.repository_id = r.id
        ${whereClause}
      `,
      params.slice(0, -2),
    ),
  ]);

  return {
    jobs: rows.map(mapJob),
    total: parseInt(totalResult.count, 10),
  };
}

export async function getJob(
  env: DbEnv,
  jobId: string,
): Promise<JobRow | null> {
  const [row] = await queryRows<JobRow>(
    env,
    `SELECT * FROM jobs WHERE id = $1`,
    [jobId],
  );
  return row ?? null;
}

export async function getJobDetail(env: DbEnv, jobId: string) {
  if (
    !jobId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      jobId,
    )
  ) {
    return null;
  }

  const [row] = await queryRows<JobDetailRow>(
    env,
    `
      SELECT
        j.*,
        r.owner,
        r.repo,
        r.installation_id,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', fr.id,
                'jobId', fr.job_id,
                'filePath', fr.file_path,
                'fileStatus', fr.file_status,
                'modelUsed', fr.model_used,
                'diffLineCount', fr.diff_line_count,
                'diffInput', fr.diff_input,
                'rawAiOutput', fr.raw_ai_output,
                'inputTokens', fr.input_tokens,
                'outputTokens', fr.output_tokens,
                'durationMs', fr.duration_ms,
                'verdict', fr.verdict,
                'fileSummary', fr.file_summary,
                'errorMessage', fr.error_msg,
                'createdAt', fr.created_at,
                'modelProvider', fr.model_provider,
                'overallCorrectness', fr.overall_correctness,
                'confidenceScore', fr.confidence_score,
                -- NULL on rows written before batching existed; the logs view renders >1 as shared.
                'batchSize', fr.batch_size,
                -- What the gates dropped. Without it the logs cannot tell "found nothing" apart
                -- from "found things and withheld every one of them".
                'withheldCounts', fr.withheld_counts,
                'degraded', fr.degraded,
                'parsedComments', COALESCE(
                  (
                    SELECT JSON_AGG(
                      ${reviewCommentJsonObject(
                        // Correlated rather than joined so this stays one round trip; served by the comment_feedback (repository_id, fingerprint) index.
                        `'humanLabel', (
                          SELECT cf.outcome FROM comment_feedback cf
                          WHERE cf.repository_id = j.repository_id
                            AND cf.fingerprint = rc.fingerprint
                            AND cf.source = 'dashboard'
                          LIMIT 1
                        )`,
                      )}
                      ORDER BY rc.id ASC
                    ) FROM review_comments rc WHERE rc.file_review_id = fr.id
                  ),
                  '[]'::json
                )
              )
              ORDER BY fr.created_at ASC
            )
            FROM file_reviews fr
            WHERE fr.job_id = j.id
          ),
          '[]'::json
        ) AS files_json
      FROM jobs j
      JOIN repositories r ON j.repository_id = r.id
      WHERE j.id = $1
    `,
    [jobId],
  );

  if (!row) return null;

  return jobDetailSchema.parse({
    ...mapJob(row),
    baseSha: bytesToHex(row.base_sha),
    headRef: row.head_ref,
    baseRef: row.base_ref,
    summaryMarkdown: row.summary_markdown,
    configSnapshot: repoConfigSchema.parse(
      parseJsonColumn(row.config_snapshot, defaultRepoConfig),
    ),
    reviewId: row.review_id,
    retryOfJobId: row.retry_of_job_id,
    summaryModel: row.summary_model,
    files: parseJsonColumn(row.files_json, []),
  });
}

export async function findExistingJobForHead(
  env: DbEnv,
  input: {
    owner: string;
    repo: string;
    prNumber: number;
    commitSha: string;
    trigger: "auto" | "mention";
  },
) {
  const [row] = await queryRows<JobRow>(
    env,
    `
      SELECT j.*, r.owner, r.repo, r.installation_id
      FROM jobs j
      JOIN repositories r ON j.repository_id = r.id
      WHERE r.owner = $1
        AND r.repo = $2
        AND j.pr_number = $3
        AND j.commit_sha = $4
        AND j.trigger = $5
      ORDER BY j.created_at DESC
      LIMIT 1
    `,
    [
      input.owner,
      input.repo,
      input.prNumber,
      hexToBytes(input.commitSha),
      input.trigger,
    ],
  );

  return row ? mapJob(row) : null;
}

// Re-export so imports use db/jobs.ts (respects vi.mock).
export { type JobRow, bytesToHex, mapJob } from "./jobs-mapping";
export { markSystemActive, clearSystemActive } from "./jobs-activity";
export {
  type JobLeaseClaim,
  getJobForProcessing,
  claimJobLease,
  heartbeatJobLease,
  releaseJobLease,
  markJobContinuationQueued,
  resetJobContinuationCount,
  recoverExpiredJobLeases,
  getOtherRunningJobsCount,
} from "./jobs-leases";
export {
  updateJobCheckRun,
  completeJob,
  failJob,
  cancelJob,
  deleteJob,
  markJobCheckRunCompleted,
  updateJobFileCount,
  completePreparationStep,
  updateJobStep,
  getTerminalJobsNeedingCheckRunCompletion,
  supersedeOlderJobs,
} from "./jobs-lifecycle";
