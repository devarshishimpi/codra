import type { DbEnv } from "./env";

import { queryRows } from "./client";

// 'deleted' and 'marked_wrong' are the negative signals; 'resolved' and 'marked_right' are MEASUREMENT only, since suppressing on them would train the system to stop reporting findings that worked.
// The ABSENCE of a row is not a signal either way, so precision is only ever `marked_right / (marked_right + marked_wrong)`, reported with n.
export type CommentOutcome =
  | "posted"
  | "deleted"
  | "resolved"
  | "unresolved"
  | "marked_wrong"
  | "marked_right";

export type CommentFeedbackInput = {
  repositoryId: number;
  prNumber: number | null;
  fingerprint: string;
  anchorHash: string | null;
  // Title-independent identity, carried so a reworded repeat of a rejected claim also matches.
  fingerprintV2?: string | null;
  githubCommentId: number;
  outcome: CommentOutcome;
};

// Keyed by fingerprint, not review_comments.id: those rows are deleted and re-inserted on every re-review, so their ids anchor nothing long-lived.
export async function recordCommentFeedback(
  env: DbEnv,
  entries: CommentFeedbackInput[],
): Promise<number> {
  if (entries.length === 0) return 0;

  const rows = await queryRows<{ id: string }>(
    env,
    `
      INSERT INTO comment_feedback (repository_id, pr_number, fingerprint, anchor_hash, github_comment_id, outcome, fingerprint_v2)
      SELECT * FROM UNNEST($1::int[], $2::int[], $3::text[], $4::text[], $5::bigint[], $6::text[], $7::text[])
      ON CONFLICT (repository_id, github_comment_id, outcome) DO NOTHING
      RETURNING id
    `,
    [
      entries.map((e) => e.repositoryId),
      entries.map((e) => e.prNumber ?? null),
      entries.map((e) => e.fingerprint),
      entries.map((e) => e.anchorHash ?? null),
      entries.map((e) => e.githubCommentId),
      entries.map((e) => e.outcome),
      entries.map((e) => e.fingerprintV2 ?? null),
    ],
  );

  return rows.length;
}

// Targets the partial index on `(repository_id, fingerprint) WHERE source = 'dashboard'`, making a flip an UPDATE rather than two contradictory rows.
export async function upsertDashboardFeedback(
  env: DbEnv,
  input: {
    repositoryId: number;
    prNumber: number | null;
    fingerprint: string;
    anchorHash: string | null;
    fingerprintV2?: string | null;
    jobId: string;
    labelledBy: number | null;
    outcome: "marked_wrong" | "marked_right";
  },
): Promise<void> {
  await queryRows(
    env,
    `
      INSERT INTO comment_feedback
        (repository_id, pr_number, fingerprint, anchor_hash, github_comment_id, outcome, source, job_id, labelled_by, fingerprint_v2)
      VALUES ($1::int, $2::int, $3::text, $4::text, NULL, $5::text, 'dashboard', $6::uuid, $7::bigint, $8::text)
      ON CONFLICT (repository_id, fingerprint) WHERE source = 'dashboard'
      DO UPDATE SET
        outcome     = EXCLUDED.outcome,
        pr_number   = EXCLUDED.pr_number,
        anchor_hash = COALESCE(EXCLUDED.anchor_hash, comment_feedback.anchor_hash),
        fingerprint_v2 = COALESCE(EXCLUDED.fingerprint_v2, comment_feedback.fingerprint_v2),
        job_id      = EXCLUDED.job_id,
        labelled_by = EXCLUDED.labelled_by,
        updated_at  = now()
    `,
    [
      input.repositoryId,
      input.prNumber,
      input.fingerprint,
      input.anchorHash,
      input.outcome,
      input.jobId,
      input.labelledBy,
      input.fingerprintV2 ?? null,
    ],
  );
}

// Scoped to `source = 'dashboard'`: a webhook-sourced row is ground truth from GitHub and must not be erasable here.
export async function clearDashboardFeedback(
  env: DbEnv,
  repositoryId: number,
  fingerprint: string,
): Promise<void> {
  await queryRows(
    env,
    `DELETE FROM comment_feedback
     WHERE repository_id = $1::int AND fingerprint = $2::text AND source = 'dashboard'`,
    [repositoryId, fingerprint],
  );
}

// Prevents a resolve -> unresolve round trip from leaving the finding permanently recorded as accepted.
export async function clearResolvedFeedback(
  env: DbEnv,
  repositoryId: number,
  githubCommentIds: number[],
): Promise<void> {
  if (githubCommentIds.length === 0) return;
  await queryRows(
    env,
    `
      DELETE FROM comment_feedback
      WHERE repository_id = $1::int
        AND outcome = 'resolved'
        AND github_comment_id = ANY($2::bigint[])
    `,
    [repositoryId, githubCommentIds],
  );
}
