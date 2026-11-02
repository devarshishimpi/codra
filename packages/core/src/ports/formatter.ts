import type { ParsedReviewComment } from "@codraoss/schema";

export interface ReviewFormatter {
  toReviewEvent(verdict: "approve" | "comment"): "APPROVE" | "COMMENT";
  summarizeVerdict(
    comments: ParsedReviewComment[],
    hasFailures: boolean,
  ): { verdict: "approve" | "comment"; errors: number; warnings: number };
  formatInlineComment(comment: ParsedReviewComment): string;
  formatReviewOverview(input: ReviewOverviewInput): string;
}

export type ReviewOverviewInput = {
  commitSha: string;
  /** Comments actually posted. Zero means the header must not promise suggestions. */
  postedFindings: number;
  filesReviewed: number;
  linesReviewed: number;
  /** Candidates the gates dropped; on a clean review this is what "nothing to report" cost. */
  withheldFindings: number;
  filesFailed: number;
};
