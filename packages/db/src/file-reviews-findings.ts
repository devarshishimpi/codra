import type { DbEnv } from "./env";
import type { SuppressedFinding } from "@codraoss/core/ports";
import { queryRows } from "./client";

export type { SuppressedFinding } from "@codraoss/core/ports";

// Findings already posted on an EARLIER commit with the anchored line unchanged, or rejected by a human anywhere in this repository.
// `j.commit_sha <> me.commit_sha` is load-bearing: retries and mention-triggered re-reviews reuse the SAME head commit.
export async function getSuppressedFindings(
  env: DbEnv,
  jobId: string,
): Promise<SuppressedFinding[]> {
  return queryRows<SuppressedFinding>(
    env,
    `
      WITH me AS (
        SELECT repository_id, pr_number, commit_sha FROM jobs WHERE id = $1::uuid
      ),
      already_posted AS (
        SELECT DISTINCT rc.fingerprint, rc.anchor_hash, rc.fingerprint_v2
        FROM me
        JOIN jobs            j  ON j.repository_id = me.repository_id AND j.pr_number = me.pr_number
        JOIN file_reviews    fr ON fr.job_id = j.id
        JOIN review_comments rc ON rc.file_review_id = fr.id
        WHERE j.id <> $1::uuid
          AND j.commit_sha <> me.commit_sha
          AND rc.posted
          -- Either identity is enough: v1 alone misses reworded repeats.
          AND (rc.fingerprint IS NOT NULL OR rc.fingerprint_v2 IS NOT NULL)
      ),
      rejected AS (
        -- Only NEGATIVE outcomes: suppressing on 'resolved'/'marked_right' would silence findings that turned out correct, and "no row" is not a negative signal.
        SELECT DISTINCT cf.fingerprint, NULL::text AS anchor_hash, cf.fingerprint_v2
        FROM me
        JOIN comment_feedback cf ON cf.repository_id = me.repository_id
        WHERE cf.outcome IN ('deleted', 'marked_wrong')
          AND (cf.fingerprint IS NOT NULL OR cf.fingerprint_v2 IS NOT NULL)
      )
      SELECT fingerprint, anchor_hash, fingerprint_v2, TRUE  AS anchored FROM already_posted
      UNION ALL
      SELECT fingerprint, anchor_hash, fingerprint_v2, FALSE AS anchored FROM rejected
    `,
    [jobId],
  );
}

// Job scoping is the authorization boundary, not a convenience: a label writes a REPOSITORY-WIDE suppression.
export async function getFindingLabelTarget(
  env: DbEnv,
  jobId: string,
  fingerprint: string,
): Promise<{
  repository_id: number;
  pr_number: number | null;
  anchor_hash: string | null;
  fingerprint_v2: string | null;
} | null> {
  const rows = await queryRows<{
    repository_id: number;
    pr_number: number | null;
    anchor_hash: string | null;
    fingerprint_v2: string | null;
  }>(
    env,
    `
      SELECT j.repository_id, j.pr_number, rc.anchor_hash, rc.fingerprint_v2
      FROM jobs j
      JOIN file_reviews    fr ON fr.job_id = j.id
      JOIN review_comments rc ON rc.file_review_id = fr.id
      WHERE j.id = $1::uuid AND rc.fingerprint = $2::text
      LIMIT 1
    `,
    [jobId, fingerprint],
  );
  return rows[0] ?? null;
}

// Only fingerprints GitHub genuinely accepted: marking a silently dropped one posted would hide it forever.
export async function markCommentsPosted(
  env: DbEnv,
  jobId: string,
  fingerprints: string[],
): Promise<void> {
  if (fingerprints.length === 0) return;
  await queryRows(
    env,
    `
      UPDATE review_comments rc
      SET posted = TRUE, disposition = 'posted'
      FROM file_reviews fr
      WHERE fr.id = rc.file_review_id
        AND fr.job_id = $1::uuid
        AND rc.fingerprint = ANY($2::text[])
    `,
    [jobId, fingerprints],
  );
}

// `posted = false` alone conflates the severity/confidence gates, suppression, dedupe, the verifier, and the max_comments cap, so attribution must be recorded where the decision is made.
export async function markCommentDispositions(
  env: DbEnv,
  jobId: string,
  byFingerprint: Map<
    string,
    { disposition: string | null; reason: string | null }
  >,
): Promise<void> {
  if (byFingerprint.size === 0) return;
  const fingerprints = [...byFingerprint.keys()];
  const dispositions = fingerprints.map(
    (fp) => byFingerprint.get(fp)!.disposition,
  );
  const reasons = fingerprints.map((fp) => byFingerprint.get(fp)!.reason);

  // A posted finding's disposition is never rewritten: fingerprint collisions on same-titled findings once overwrote a real P0's 'posted' with 'suppression'. `posted` is GitHub's fact; disposition is our inference, so the fact wins.
  await queryRows(
    env,
    `
      UPDATE review_comments rc
      SET disposition   = CASE WHEN rc.posted THEN rc.disposition
                               ELSE COALESCE(d.disposition, rc.disposition) END,
          verify_reason = COALESCE(d.reason, rc.verify_reason)
      FROM file_reviews fr,
           UNNEST($2::text[], $3::text[], $4::text[]) AS d(fingerprint, disposition, reason)
      WHERE fr.id = rc.file_review_id
        AND fr.job_id = $1::uuid
        AND rc.fingerprint = d.fingerprint
    `,
    [jobId, fingerprints, dispositions, reasons],
  );
}
