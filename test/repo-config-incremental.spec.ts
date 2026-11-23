import { describe, expect, it } from "vitest";
import { defaultRepoConfig, normalizeRepoConfig, repoConfigSchema } from "@codraoss/schema";

describe("review.incremental", () => {
  it("defaults to false when unset", () => {
    expect(repoConfigSchema.parse({}).review.incremental).toBe(false);
    expect(repoConfigSchema.parse({ review: {} }).review.incremental).toBe(false);
    expect(defaultRepoConfig.review.incremental).toBe(false);
  });

  it("parses an explicit opt-in and keeps it through normalization", () => {
    const parsed = repoConfigSchema.parse({ review: { incremental: true } });
    expect(parsed.review.incremental).toBe(true);
    expect(normalizeRepoConfig(parsed).review.incremental).toBe(true);
  });

  it("rejects a non-boolean value", () => {
    expect(repoConfigSchema.safeParse({ review: { incremental: "yes" } }).success).toBe(false);
  });
});
