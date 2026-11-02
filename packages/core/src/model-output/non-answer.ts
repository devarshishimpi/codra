import type { FileDiff } from "../diff";

import {
  NON_ANSWER_MAX_RESPONSE_CHARS,
  NON_ANSWER_MIN_DIFF_LINES,
} from "../constants";

/**
 * True when a review response is a non-answer: a substantive diff dismissed in a sentence with no
 * findings. Deliberately conservative -- it must never fire on a small diff, and never when the model
 * actually engaged, because the cost of a false positive is an escalation that spends real quota.
 */
export function isNonAnswerReview(input: {
  rawText: string;
  file: Pick<FileDiff, "lineCount">;
  findingCount: number;
  minDiffLines?: number;
}): boolean {
  if (input.findingCount > 0) return false;
  if (input.file.lineCount < (input.minDiffLines ?? NON_ANSWER_MIN_DIFF_LINES))
    return false;
  return input.rawText.trim().length < NON_ANSWER_MAX_RESPONSE_CHARS;
}
