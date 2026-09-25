import { describe, expect, it } from "vitest";
import {
  MODEL_FALLBACK_CHAIN_BUDGET_MS,
  MODEL_TIMEOUT_BASE_MS,
  MODEL_TIMEOUT_MAX_MS,
  VERIFY_TIMEOUT_FLOOR_MS,
  adaptiveModelTimeoutMs,
  chainAttemptTimeoutMs,
  verifyTimeoutMs,
} from "../../src/limits";

// Verification silently skipped in production, and the arithmetic is why: it borrowed
// `adaptiveModelTimeoutMs` with `candidates * 8` standing in for diff lines, which for any realistic
// finding count sat under the 100-line free allowance and collapsed to the 20s BASE. Two rungs timed
// out at 20s each, the fixed-timeout chain check then judged that no third full attempt would fit, and
// two configured models were never tried.

describe("verifyTimeoutMs", () => {
  // The regression that mattered: the old proxy gave the same 20s to 1 finding and to 12.
  it("does not collapse to the base timeout for a normal finding count", () => {
    for (const candidates of [1, 5, 10, 12]) {
      const old = adaptiveModelTimeoutMs(candidates * 8);
      expect(old).toBe(MODEL_TIMEOUT_BASE_MS);
      expect(verifyTimeoutMs(candidates)).toBeGreaterThan(old);
    }
  });

  it("floors at a workable amount and grows with the candidate count", () => {
    expect(verifyTimeoutMs(0)).toBe(VERIFY_TIMEOUT_FLOOR_MS);
    expect(verifyTimeoutMs(10)).toBe(VERIFY_TIMEOUT_FLOOR_MS);
    expect(verifyTimeoutMs(20)).toBeGreaterThan(verifyTimeoutMs(10));
    expect(verifyTimeoutMs(40)).toBeGreaterThan(verifyTimeoutMs(20));
  });

  it("never exceeds the per-call ceiling", () => {
    // 40 is verifyCandidateLimit's maximum; the ceiling exists to leave room for a failover.
    expect(verifyTimeoutMs(40)).toBeLessThanOrEqual(MODEL_TIMEOUT_MAX_MS);
    expect(verifyTimeoutMs(10_000)).toBe(MODEL_TIMEOUT_MAX_MS);
  });
});

describe("the verification chain fits two real attempts", () => {
  /** Replays how the chain grants time, rung by rung, with each rung spending its whole grant. */
  function walk(candidates: number, models: number) {
    const requested = verifyTimeoutMs(candidates);
    const grants: number[] = [];
    let elapsed = 0;

    for (let i = 0; i < models; i++) {
      const grant = chainAttemptTimeoutMs({
        requestedMs: requested,
        remainingChainMs: MODEL_FALLBACK_CHAIN_BUDGET_MS - elapsed,
        hasAnotherModel: i < models - 1,
      });
      // The head is guaranteed an attempt; a fallback with no room stops the chain.
      if (grant === 0 && i > 0) break;
      grants.push(Math.max(grant, 8_000));
      elapsed += grants[grants.length - 1];
    }
    return { requested, grants, elapsed };
  }

  // The production shape: 4 configured models, a dozen findings, every attempt timing out.
  it("tries at least two models even when every attempt burns its full grant", () => {
    const { grants } = walk(12, 4);

    expect(grants.length).toBeGreaterThanOrEqual(2);
    // And the head gets more than the 20s that was timing out.
    expect(grants[0]).toBeGreaterThan(MODEL_TIMEOUT_BASE_MS);
  });

  it("keeps the whole chain inside the invocation budget", () => {
    for (const candidates of [1, 12, 25, 40]) {
      const { elapsed } = walk(candidates, 4);
      expect(elapsed).toBeLessThanOrEqual(MODEL_FALLBACK_CHAIN_BUDGET_MS);
    }
  });

  it("gives a single-model chain its full request", () => {
    const { requested, grants } = walk(12, 1);

    expect(grants).toEqual([requested]);
  });

  // A rung must never be handed a slice too small to answer in -- that spends a subrequest to
  // guarantee another timeout.
  it("never grants a viable rung less than the minimum attempt", () => {
    for (const candidates of [1, 12, 40]) {
      for (const grant of walk(candidates, 4).grants) {
        expect(grant).toBeGreaterThanOrEqual(8_000);
      }
    }
  });
});
