import { describe, expect, it } from "vitest";
import {
  isPlausibleTokenBucket,
  parseRateLimitFromError,
} from "@codraoss/models";

// Verbatim from production: a free-tier 429 whose only stated quota counts REQUESTS, not tokens.
const REQUESTS_QUOTA_429 = [
  "You exceeded your current quota, please check your plan and billing details.",
  "For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.",
  "To monitor your current usage, head to: https://ai.dev/rate-limit.",
  "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-3.5-flash-lite",
  "Please retry in 21.35281435s.",
].join("\n");

const TOKENS_QUOTA_429 =
  "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 16000, model: gemini-2.5-flash Please retry in 26.9s.";

describe("parseRateLimitFromError", () => {
  // The regression: `limit: 15` is 15 requests per minute. Reading it as a 15-token bucket made
  // skipReason refuse every prompt over 12 tokens for the rest of the job -- a model that was merely
  // busy for a minute was taken out for 24 hours, and the whole fallback chain with it.
  it("does not read a request-count quota as a token bucket", () => {
    const parsed = parseRateLimitFromError(new Error(REQUESTS_QUOTA_429));

    expect(parsed.limitTokens).toBeUndefined();
    // The cool-off is still learned: the model IS rate-limited, just not by prompt size.
    expect(parsed.retryAfterMs).toBeCloseTo(21352.81435, 3);
  });

  it("reads a genuine token quota", () => {
    const parsed = parseRateLimitFromError(new Error(TOKENS_QUOTA_429));

    expect(parsed.limitTokens).toBe(16000);
    expect(parsed.retryAfterMs).toBe(26900);
  });

  // A body may state several violated quotas, and the request count often comes first -- which a bare
  // /limit:\s*(\d+)/ would happily return as the bucket size.
  it("picks the token quota out of a multi-quota body, not the first limit stated", () => {
    const parsed = parseRateLimitFromError(
      new Error(
        [
          "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: m",
          "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 16000, model: m",
        ].join("\n"),
      ),
    );

    expect(parsed.limitTokens).toBe(16000);
  });

  it("takes the smallest stated token bucket, which rejects a prompt first", () => {
    const parsed = parseRateLimitFromError(
      new Error(
        [
          "* Quota exceeded for metric: x/input_token_count, limit: 32000, model: m",
          "* Quota exceeded for metric: x/output_token_count, limit: 8000, model: m",
        ].join("\n"),
      ),
    );

    expect(parsed.limitTokens).toBe(8000);
  });

  it("rejects an implausibly small token bucket even from a token metric", () => {
    const parsed = parseRateLimitFromError(
      new Error(
        "* Quota exceeded for metric: x/input_token_count, limit: 15, model: m",
      ),
    );

    expect(parsed.limitTokens).toBeUndefined();
  });

  it("returns nothing for an error that states no quota at all", () => {
    const parsed = parseRateLimitFromError(
      new Error("Resource has been exhausted."),
    );

    expect(parsed.limitTokens).toBeUndefined();
    expect(parsed.retryAfterMs).toBeUndefined();
  });
});

describe("isPlausibleTokenBucket", () => {
  it("rejects request counts and accepts real buckets", () => {
    expect(isPlausibleTokenBucket(15)).toBe(false);
    expect(isPlausibleTokenBucket(undefined)).toBe(false);
    expect(isPlausibleTokenBucket(16000)).toBe(true);
  });
});
