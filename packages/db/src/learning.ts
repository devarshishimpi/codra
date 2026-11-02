import type { DbEnv } from "./env";
import { queryRows } from "./client";
import type { ClaimType } from "@codraoss/schema";

// Reads over findings a human has already judged: report only over the LABELLED subset, always with n. The absence of a label is not a signal.

export type RejectedExemplar = {
  title: string;
  body: string;
  claim_type: ClaimType | null;
  context_snippet: string | null;
  path: string;
};

// Findings a human rejected, injected as negative few-shot exemplars: retrieval measurably improves small models here (F1 36.35 -> 74.05 at 20 shots). Claim-type-keyed since there's no vector store.
export async function getRejectedExemplars(
  env: DbEnv,
  input: {
    repositoryId: number;
    claimTypes?: readonly ClaimType[];
    limit?: number;
  },
): Promise<RejectedExemplar[]> {
  const limit = Math.min(input.limit ?? 5, 20);

  return queryRows<RejectedExemplar>(
    env,
    `
      SELECT DISTINCT ON (rc.fingerprint)
             rc.title, rc.body, rc.claim_type, rc.context_snippet, rc.path
      FROM comment_feedback cf
      JOIN review_comments rc
        ON rc.fingerprint = cf.fingerprint
        -- OR-matched, same as suppression: v1 dies the moment the model rewords a title.
        OR (rc.fingerprint_v2 IS NOT NULL AND rc.fingerprint_v2 = cf.fingerprint_v2)
      WHERE cf.repository_id = $1
        AND cf.outcome IN ('deleted', 'marked_wrong')
        AND rc.title IS NOT NULL
        AND ($2::text[] IS NULL OR rc.claim_type = ANY($2::text[]))
      ORDER BY rc.fingerprint, rc.id DESC
      LIMIT $3
    `,
    [
      input.repositoryId,
      input.claimTypes?.length ? [...input.claimTypes] : null,
      limit,
    ],
  );
}

// Exemplars are repository-scoped -- what one team rejects isn't evidence about another.
export async function getRepositoryIdForJob(
  env: DbEnv,
  jobId: string,
): Promise<number | null> {
  const [row] = await queryRows<{ repository_id: number }>(
    env,
    `SELECT repository_id FROM jobs WHERE id = $1::uuid`,
    [jobId],
  );
  return row?.repository_id ?? null;
}
