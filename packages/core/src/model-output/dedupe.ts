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
  options?: number | { lineRadius?: number },
): ParsedReviewComment[] {
  const lineRadius =
    typeof options === "number" ? options : (options?.lineRadius ?? 0);
  const best = new Map<string, ParsedReviewComment>();
  const byFile = new Map<string, ParsedReviewComment[]>();

  for (const comment of comments) {
    const normalizedTitle =
      comment.source === "rule" ? "" : normalizeFindingTitle(comment.title);
    if (comment.source !== "rule" && !normalizedTitle) {
      best.set(`__unique__${best.size}`, comment);
      continue;
    }

    // Proximity check on the same file
    if (lineRadius > 0 && comment.line != null && comment.source !== "rule") {
      const fileComments = byFile.get(comment.path) ?? [];
      const nearby = fileComments.find(
        (c) =>
          c.line != null &&
          Math.abs(c.line - (comment.line ?? 0)) <= lineRadius &&
          normalizeFindingTitle(c.title) === normalizedTitle,
      );

      if (nearby) {
        const rank = SEVERITY_RANK[comment.severity] ?? 4;
        const nearbyRank = SEVERITY_RANK[nearby.severity] ?? 4;
        const isBetter =
          rank < nearbyRank ||
          (rank === nearbyRank &&
            (comment.confidenceScore ?? 0) > (nearby.confidenceScore ?? 0));
        if (isBetter) {
          // Replace nearby with better comment
          const oldKey = `llm${NUL}${nearby.path}${NUL}${nearby.anchorHash ?? nearby.line ?? ""}${NUL}${normalizedTitle}`;
          best.delete(oldKey);
          const newKey = `llm${NUL}${comment.path}${NUL}${comment.anchorHash ?? comment.line ?? ""}${NUL}${normalizedTitle}`;
          best.set(newKey, comment);
          const idx = fileComments.indexOf(nearby);
          if (idx !== -1) fileComments[idx] = comment;
        }
        continue;
      }
    }

    const key =
      comment.source === "rule"
        ? `rule${NUL}${comment.ruleId ?? ""}${NUL}${comment.path}${NUL}${comment.anchorHash ?? ""}`
        : `llm${NUL}${comment.path}${NUL}${comment.anchorHash ?? comment.line ?? ""}${NUL}${normalizedTitle}`;
    const existing = best.get(key);
    if (!existing) {
      best.set(key, comment);
      if (comment.source !== "rule") {
        const list = byFile.get(comment.path) ?? [];
        list.push(comment);
        byFile.set(comment.path, list);
      }
      continue;
    }
    const rank = SEVERITY_RANK[comment.severity] ?? 4;
    const existingRank = SEVERITY_RANK[existing.severity] ?? 4;
    const isBetter =
      rank < existingRank ||
      (rank === existingRank &&
        (comment.confidenceScore ?? 0) > (existing.confidenceScore ?? 0));
    if (isBetter) {
      best.set(key, comment);
      if (comment.source !== "rule") {
        const list = byFile.get(comment.path) ?? [];
        const idx = list.indexOf(existing);
        if (idx !== -1) list[idx] = comment;
      }
    }
  }
  return Array.from(best.values());
}
