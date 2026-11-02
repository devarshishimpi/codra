import { describe, it, expect } from "vitest";
import { TokenTracker } from "@codraoss/core/token-tracker";

// Regression for subrequest-exhaustion incident (job bb9cf692): nothing checked remaining budget before more concurrent work.

describe("TokenTracker.remainingSafeBudget", () => {
  it("starts with the full margin below the hard cap available", () => {
    const tracker = new TokenTracker();
    expect(tracker.remainingSafeBudget()).toBe(25); // 50 - 25 margin
  });

  it("shrinks by exactly what has been spent so far", () => {
    const tracker = new TokenTracker();
    tracker.incrementSubrequests(10);
    expect(tracker.remainingSafeBudget()).toBe(15);

    tracker.incrementSubrequests(5);
    expect(tracker.remainingSafeBudget()).toBe(10);
  });

  it("never goes negative once spending exceeds the safe margin", () => {
    const tracker = new TokenTracker();
    tracker.incrementSubrequests(45);
    expect(tracker.remainingSafeBudget()).toBe(0);

    tracker.incrementSubrequests(100);
    expect(tracker.remainingSafeBudget()).toBe(0);
  });

  it("agrees with isNearLimit at the same threshold", () => {
    const tracker = new TokenTracker();
    tracker.incrementSubrequests(24); // threshold is 25
    expect(tracker.isNearLimit()).toBe(false);
    expect(tracker.remainingSafeBudget()).toBeGreaterThan(0);

    tracker.incrementSubrequests(1);
    expect(tracker.isNearLimit()).toBe(true);
    expect(tracker.remainingSafeBudget()).toBe(0);
  });
});

// record() only ran on success, so retried/429'd sends were invisible to accounting.
describe("TokenTracker wasted-attempt accounting", () => {
  it("counts failed attempts by reason without touching billed usage", () => {
    const tracker = new TokenTracker();
    tracker.record("google:m", 1000, 200);
    tracker.recordFailedAttempt("google:m", 3000, "rate-limited");
    tracker.recordFailedAttempt("google:m", 3000, "error");
    tracker.recordFailedAttempt("google:m", 3000, "rate-limited");

    expect(tracker.getTotalUsage()).toEqual({ input: 1000, output: 200 });
    expect(tracker.getBreakdown()).toHaveLength(1);

    expect(tracker.getWasted()).toEqual({
      attempts: 3,
      estimatedInput: 9000,
      skips: 0,
      byReason: { "rate-limited": 2, error: 1 },
    });
  });

  it("counts skipped calls separately -- the signal that the cool-off gates are working", () => {
    const tracker = new TokenTracker();
    tracker.recordSkippedCall("google:m", "cooling off for another 42s");
    tracker.recordSkippedCall("google:m", "cooling off for another 41s");

    const wasted = tracker.getWasted();
    expect(wasted.skips).toBe(2);
    expect(wasted.attempts).toBe(0);
    expect(wasted.estimatedInput).toBe(0);
  });

  it("carries wasted counters through merge, so a per-chunk tracker rolls up", () => {
    const parent = new TokenTracker();
    parent.recordFailedAttempt("google:m", 1000, "error");
    parent.recordSkippedCall("google:m", "cooling off");

    const child = new TokenTracker();
    child.record("google:m", 500, 100);
    child.recordFailedAttempt("google:m", 2000, "rate-limited");
    child.recordFailedAttempt("google:m", 2000, "error");
    child.recordSkippedCall("google:m", "cooling off");

    parent.merge(child);

    expect(parent.getTotalUsage()).toEqual({ input: 500, output: 100 });
    expect(parent.getWasted()).toEqual({
      attempts: 3,
      estimatedInput: 5000,
      skips: 2,
      byReason: { error: 2, "rate-limited": 1 },
    });
  });

  it("clears wasted counters on reset alongside usage", () => {
    const tracker = new TokenTracker();
    tracker.record("google:m", 100, 10);
    tracker.recordFailedAttempt("google:m", 1000, "error");
    tracker.recordSkippedCall("google:m", "cooling off");

    tracker.reset();

    expect(tracker.getTotalUsage()).toEqual({ input: 0, output: 0 });
    expect(tracker.getWasted()).toEqual({
      attempts: 0,
      estimatedInput: 0,
      skips: 0,
      byReason: {},
    });
  });
});
