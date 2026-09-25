import type { ParsedReviewComment } from "@codraoss/schema";
import { normalizeFindingTitle } from "../fingerprint";

const SEVERITY_RANK: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  nit: 4,
};

const NUL = String.fromCharCode(0);

export function dedupeFindings(
  comments: ParsedReviewComment[],
): ParsedReviewComment[] {
  const best = new Map<string, ParsedReviewComment>();
  for (const comment of comments) {
    // Union, keyed per location. Never weight by agreement: 7 configs agreeing measured 7% correct, 1 config 20%.
    const normalizedTitle =
      comment.source === "rule" ? "" : normalizeFindingTitle(comment.title);
    if (comment.source !== "rule" && !normalizedTitle) {
      best.set(`__unique__${best.size}`, comment);
      continue;
    }

    const key =
      comment.source === "rule"
        ? `rule${NUL}${comment.ruleId ?? ""}${NUL}${comment.path}${NUL}${comment.anchorHash ?? ""}`
        : `llm${NUL}${comment.path}${NUL}${comment.anchorHash ?? comment.line ?? ""}${NUL}${normalizedTitle}`;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, comment);
      continue;
    }
    const rank = SEVERITY_RANK[comment.severity] ?? 4;
    const existingRank = SEVERITY_RANK[existing.severity] ?? 4;
    const isBetter =
      rank < existingRank ||
      (rank === existingRank &&
        (comment.confidenceScore ?? 0) > (existing.confidenceScore ?? 0));
    if (isBetter) best.set(key, comment);
  }
  return Array.from(best.values());
}
