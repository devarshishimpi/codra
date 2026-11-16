import { describe, it, expect } from "vitest";
import {
  budgetAwareFileLimit,
  DEFAULT_MAX_SUBREQUESTS,
  DEFAULT_SUBREQUEST_SAFE_MARGIN,
  PAID_WORKER_MAX_SUBREQUESTS,
  TokenTracker,
} from "@codraoss/core";
import { resolveWorkerSubrequestLimits } from "../../apps/worker/src/adapters";
import { resolveNodeSubrequestLimits } from "../../apps/node/src/runtime";

describe("Subrequest Limits & Decoupling", () => {
  describe("resolveWorkerSubrequestLimits", () => {
    it("preserves Cloudflare free tier default (50 max, 25 safe margin) when no override provided", () => {
      const limits = resolveWorkerSubrequestLimits({});
      expect(limits).toEqual({
        maxSubrequests: DEFAULT_MAX_SUBREQUESTS,
        safeMargin: DEFAULT_SUBREQUEST_SAFE_MARGIN,
      });
      expect(limits.maxSubrequests).toBe(50);
      expect(limits.safeMargin).toBe(25);
    });

    it("uses paid worker limit (1000) when CF_PAID_WORKER is set to true / 'true' / '1'", () => {
      expect(resolveWorkerSubrequestLimits({ CF_PAID_WORKER: true })).toEqual({
        maxSubrequests: PAID_WORKER_MAX_SUBREQUESTS,
      });
      expect(resolveWorkerSubrequestLimits({ CF_PAID_WORKER: "true" })).toEqual({
        maxSubrequests: 1000,
      });
      expect(resolveWorkerSubrequestLimits({ CF_PAID_WORKER: "1" })).toEqual({
        maxSubrequests: 1000,
      });
    });

    it("respects explicit CF_SUBREQUEST_LIMIT override", () => {
      expect(resolveWorkerSubrequestLimits({ CF_SUBREQUEST_LIMIT: 250 })).toEqual({
        maxSubrequests: 250,
      });
      expect(resolveWorkerSubrequestLimits({ CF_SUBREQUEST_LIMIT: "500" })).toEqual({
        maxSubrequests: 500,
      });
    });
  });

  describe("resolveNodeSubrequestLimits", () => {
    it("defaults to unconstrained (Infinity) subrequests in Node.js / Docker", () => {
      const limits = resolveNodeSubrequestLimits({});
      expect(limits.maxSubrequests).toBe(Number.POSITIVE_INFINITY);
    });

    it("allows optional SUBREQUEST_LIMIT override in Node.js", () => {
      const limits = resolveNodeSubrequestLimits({ SUBREQUEST_LIMIT: 300 });
      expect(limits.maxSubrequests).toBe(300);
    });

    it("allows optional CF_SUBREQUEST_LIMIT override in Node.js", () => {
      const limits = resolveNodeSubrequestLimits({ CF_SUBREQUEST_LIMIT: "400" });
      expect(limits.maxSubrequests).toBe(400);
    });
  });


  describe("budgetAwareFileLimit with unconstrained budget", () => {
    it("does not constrain file limits when budget is Infinity", () => {
      const tracker = new TokenTracker({ maxSubrequests: Number.POSITIVE_INFINITY });
      const safeBudget = tracker.remainingSafeBudget();
      expect(safeBudget).toBe(Number.POSITIVE_INFINITY);

      // Concurrency limits are fully respected without being squeezed down by subrequests
      expect(budgetAwareFileLimit(safeBudget, 4, 3, true, true)).toBe(4);
      expect(budgetAwareFileLimit(safeBudget, 10, 1, false, false)).toBe(10);
    });
  });
});
