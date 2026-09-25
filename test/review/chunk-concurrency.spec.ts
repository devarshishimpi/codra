import { describe, expect, it } from "vitest";
import {
  budgetAwareFileLimit,
  estimatedSubrequestsPerFile,
} from "@server/core/review";
import { TokenTracker } from "@codraoss/core/token-tracker";
import {
  REVIEW_CONCURRENCY_LIMITS,
  reviewConcurrencyLevels,
} from "@codraoss/schema";

// Regression guard for "concurrency slider is dead above medium": the per-chunk budget cap must
// NOT silently override the configured concurrency at a healthy budget. Exercises the REAL
// TokenTracker and REVIEW_CONCURRENCY_LIMITS, so a slider-defeating change to SAFE_MARGIN or
// ESTIMATED_SUBREQUESTS_PER_FILE fails this test.

const maxLevel = Math.max(
  ...reviewConcurrencyLevels.map((level) => REVIEW_CONCURRENCY_LIMITS[level]),
);

describe("budgetAwareFileLimit", () => {
  it("honors every configured concurrency level at a fresh budget", () => {
    const fresh = new TokenTracker().remainingSafeBudget();
    for (const level of reviewConcurrencyLevels) {
      const configured = REVIEW_CONCURRENCY_LIMITS[level];
      expect(budgetAwareFileLimit(fresh, configured)).toBe(configured);
    }
  });

  it("still honors the highest level after the getPullRequest preamble spends a few subrequests", () => {
    const tracker = new TokenTracker();
    tracker.incrementSubrequests(3); // token read + getPullRequest + a little slack
    expect(budgetAwareFileLimit(tracker.remainingSafeBudget(), maxLevel)).toBe(
      maxLevel,
    );
  });

  it("throttles below the configured level only once the budget has actually been eaten into", () => {
    // Deep into a troubled invocation the cap should shrink to protect the 50-subrequest ceiling.
    expect(budgetAwareFileLimit(0, maxLevel)).toBe(0);
    expect(budgetAwareFileLimit(4, maxLevel)).toBeLessThan(maxLevel);
    expect(budgetAwareFileLimit(10, maxLevel)).toBeLessThan(maxLevel);
  });

  it("never exceeds the configured level even with a huge budget", () => {
    expect(budgetAwareFileLimit(10_000, 2)).toBe(2);
  });

  // A nine-model chain costs far more per file than a one-model chain when the primary is
  // rate-limited; budgeting a flat 5 for both let files start on a budget that couldn't cover
  // them, dying with "Too many subrequests".
  it("budgets more per file for a longer fallback chain", () => {
    expect(estimatedSubrequestsPerFile(9)).toBeGreaterThan(
      estimatedSubrequestsPerFile(1),
    );
  });

  it("caps the per-file estimate so a long chain cannot collapse concurrency to nothing", () => {
    // Beyond the attempt ceiling the estimate stops growing; a fresh budget must still honour
    // the highest configured level even with a very long chain.
    expect(estimatedSubrequestsPerFile(50)).toBe(
      estimatedSubrequestsPerFile(9),
    );
    const fresh = new TokenTracker().remainingSafeBudget();
    expect(budgetAwareFileLimit(fresh, maxLevel, 9)).toBe(maxLevel);
  });

  it("shrinks the chunk sooner on a long chain than a short one at a degraded budget", () => {
    expect(budgetAwareFileLimit(12, maxLevel, 9)).toBeLessThan(
      budgetAwareFileLimit(12, maxLevel, 1),
    );
  });

  it("prices the extra content fetch without ever driving the limit to zero", () => {
    expect(estimatedSubrequestsPerFile(3, true)).toBe(
      estimatedSubrequestsPerFile(3) + 1,
    );
    expect(estimatedSubrequestsPerFile(3, false)).toBe(
      estimatedSubrequestsPerFile(3),
    );

    const fresh = new TokenTracker().remainingSafeBudget();
    expect(
      budgetAwareFileLimit(fresh, maxLevel, 3, true),
    ).toBeGreaterThanOrEqual(1);
  });
});
