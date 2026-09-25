import { describe, expect, it } from "vitest";
import {
  isNonAnswerReview,
  NON_ANSWER_MIN_DIFF_LINES,
} from "@codraoss/core/model-output";

// The literal response gemini-3.5-flash-lite returned for a 253-line diff: valid JSON, zero findings,
// one sentence, full confidence. 77 output tokens. Recorded verbatim so a future prompt or model change
// can be measured against the exact shape this guard exists to catch.
const OBSERVED_NON_ANSWER = JSON.stringify({
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation:
    "The patch correctly implements batched file reviews with structured Gemini output, robust error handling, proper async/await usage, and correct state tracking for retries and terminal states.",
  overall_confidence_score: 1.0,
});

describe("isNonAnswerReview", () => {
  it("flags a substantive diff dismissed in one sentence", () => {
    expect(
      isNonAnswerReview({
        rawText: OBSERVED_NON_ANSWER,
        file: { lineCount: 253 },
        findingCount: 0,
      }),
    ).toBe(true);
  });

  // 162 files in the measured job were comment-only cleanups whose empty findings arrays were CORRECT.
  // Firing on those would manufacture escalations out of accurate verdicts.
  it("never flags a small diff, however terse the response", () => {
    expect(
      isNonAnswerReview({
        rawText: OBSERVED_NON_ANSWER,
        file: { lineCount: NON_ANSWER_MIN_DIFF_LINES - 1 },
        findingCount: 0,
      }),
    ).toBe(false);
    expect(
      isNonAnswerReview({
        rawText:
          '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"Comments only."}',
        file: { lineCount: 12 },
        findingCount: 0,
      }),
    ).toBe(false);
  });

  it("never flags a response that produced a finding", () => {
    expect(
      isNonAnswerReview({
        rawText: OBSERVED_NON_ANSWER,
        file: { lineCount: 751 },
        findingCount: 1,
      }),
    ).toBe(false);
  });

  it("accepts a long, engaged clean verdict on a big diff", () => {
    // A model that actually walked the diff and concluded it is clean says considerably more than a
    // sentence. Only the terse dismissal is the signal.
    const engaged = JSON.stringify({
      findings: [],
      overall_correctness: "patch is correct",
      overall_explanation: `${"The parameter array is checked against every placeholder, the transaction wraps both statements, and the conflict target matches the unique index. ".repeat(6)}`,
      overall_confidence_score: 0.8,
    });
    expect(engaged.length).toBeGreaterThan(600);
    expect(
      isNonAnswerReview({
        rawText: engaged,
        file: { lineCount: 751 },
        findingCount: 0,
      }),
    ).toBe(false);
  });

  it("honours a caller-supplied line threshold", () => {
    expect(
      isNonAnswerReview({
        rawText: OBSERVED_NON_ANSWER,
        file: { lineCount: 50 },
        findingCount: 0,
        minDiffLines: 40,
      }),
    ).toBe(true);
  });
});
