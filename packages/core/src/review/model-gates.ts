import type { ParsedReviewComment, RepoConfig } from "@codraoss/schema";

// Review behaviour a model registry profile switches through review.model_tuning, plus the order the
// comment cap keeps findings in.

/** Whether review units should cover the whole pull request at once (profile topology "unified"). */
export function isUnifiedTopology(review: RepoConfig["review"]): boolean {
  return (
    review.model_tuning?.topology === "unified" ||
    (review as { topology_mode?: string }).topology_mode === "unified"
  );
}

/**
 * The order the comment cap keeps findings in, for every model: severity first, then whether the finding
 * quotes evidence, then confidence. The precision measurements behind the per-model caps were taken with it.
 */
export function compositeRank(
  comment: Pick<ParsedReviewComment, "severity" | "evidence" | "confidenceScore">,
): number {
  const severityRanks: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, nit: 4 };
  const severity = severityRanks[comment.severity] ?? 4;
  const confidence = typeof comment.confidenceScore === "number" ? comment.confidenceScore : 0.5;
  const hasEvidence = comment.evidence && comment.evidence.trim().length >= 4 ? 1 : 0;
  return severity * 1.0 - hasEvidence * 0.4 + (1 - confidence) * 0.5;
}
