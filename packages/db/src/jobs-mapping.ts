import { parseJsonColumn } from "./client";
import {
  defaultRepoConfig,
  jobSummarySchema,
  repoConfigSchema,
  type RepoConfig,
} from "@codraoss/schema";

// Import from db/jobs.ts, not from here: eight specs vi.mock the '@server/db/jobs' specifier, and a direct sibling import silently bypasses them.
// Deliberately imports NONE of the other jobs-* siblings, so it stays the leaf they can all depend on.

export type JobRow = {
  id: string;
  workflow_instance_id: string | null;
  installation_id: string;
  owner: string;
  repo: string;
  pr_number: number;
  pr_title: string | null;
  pr_author: string | null;
  commit_sha: ByteaValue;
  base_sha: ByteaValue;
  trigger: "auto" | "mention" | "retry";
  status:
    | "queued"
    | "running"
    | "done"
    | "failed"
    | "superseded"
    | "cancelled"
    | "stopped";
  config_snapshot:
    | { review?: RepoConfig["review"]; model?: RepoConfig["model"] }
    | string
    | null;
  check_run_id: number | null;
  check_run_completed_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  recovery_count: number | null;
  continuation_count: number | null;
  last_queue_message_at: string | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  verdict: "approve" | "comment" | null;
  file_count: number | null;
  comment_count: number | null;
  error_msg: string | null;
  head_ref: string | null;
  base_ref: string | null;
  summary_markdown: string | null;
  review_id: number | null;
  retry_of_job_id: string | null;
  summary_model: string | null;
  overall_confidence_score: number | null;
  steps: JobStep[] | string | null;
};

type JobStep = {
  name: string;
  status: "pending" | "running" | "done" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  error?: string | null;
};

type ByteaValue = ArrayBuffer | ArrayBufferView | string;

export function bytesToHex(value: ByteaValue) {
  if (typeof value === "string") {
    return value.startsWith("\\x")
      ? value.slice(2).toLowerCase()
      : value.toLowerCase();
  }

  const bytes = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function latestTimestamp(...values: Array<string | null | undefined>) {
  const now = Date.now();
  return values.reduce<string | null>((latest, value) => {
    if (!value) return latest;
    if (new Date(value).getTime() > now) return latest;
    if (!latest) return value;
    return new Date(value).getTime() > new Date(latest).getTime()
      ? value
      : latest;
  }, null);
}

export function mapJob(row: JobRow) {
  const lastQueueMessageAt = row.last_queue_message_at
    ? new Date(row.last_queue_message_at).getTime()
    : null;
  const nextRetryAt =
    row.status === "running" &&
    row.lease_owner === null &&
    lastQueueMessageAt !== null &&
    Number.isFinite(lastQueueMessageAt) &&
    lastQueueMessageAt > Date.now()
      ? row.last_queue_message_at
      : null;
  const updatedAt =
    latestTimestamp(
      row.created_at,
      row.started_at,
      row.finished_at,
      row.heartbeat_at,
      row.last_queue_message_at,
    ) ?? row.created_at;

  return jobSummarySchema.parse({
    id: row.id,
    owner: row.owner,
    repo: row.repo,
    installationId: row.installation_id,
    prNumber: row.pr_number,
    prTitle: row.pr_title,
    prAuthor: row.pr_author,
    commitSha: bytesToHex(row.commit_sha),
    trigger: row.trigger,
    status: row.status,
    verdict: row.verdict,
    fileCount: row.file_count ?? 0,
    commentCount: row.comment_count ?? 0,
    totalInputTokens: row.total_input_tokens ?? 0,
    totalOutputTokens: row.total_output_tokens ?? 0,
    createdAt: row.created_at,
    updatedAt,
    nextRetryAt,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_msg,
    overallConfidenceScore: row.overall_confidence_score,
    steps: parseJsonColumn(row.steps, []),
    checkRunId: row.check_run_id,
    configSnapshot: row.config_snapshot
      ? repoConfigSchema.parse(
          parseJsonColumn(row.config_snapshot, defaultRepoConfig),
        )
      : null,
    retryOfJobId: row.retry_of_job_id,
    workflowInstanceId: row.workflow_instance_id,
  });
}
