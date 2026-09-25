import { describe, expect, it } from "vitest";
import {
  ModelCallGate,
  adaptiveModelTimeoutMs,
  clampTimeoutToChainBudget,
  geminiThinkingBudgetTokens,
  MODEL_FALLBACK_CHAIN_BUDGET_MS,
  MODEL_TIMEOUT_BASE_MS,
  MODEL_TIMEOUT_MAX_MS,
  OUTPUT_TOKENS_FLOOR,
  resolveOutputTokenCeiling,
  reviewOutputBudgetTokens,
} from "../../src/limits";
import { generatorFindingCap } from "@codraoss/core/prompts/file-review";

// Overrun output repairs to a JSON prefix, silently emptying tail files: indistinguishable from clean.
describe("reviewOutputBudgetTokens", () => {
  it("never asks for less than the floor", () => {
    expect(reviewOutputBudgetTokens({ findingCap: 1, fileCount: 1 })).toBe(
      OUTPUT_TOKENS_FLOOR,
    );
  });

  it("grows with the number of findings the prompt asked for", () => {
    const one = reviewOutputBudgetTokens({
      findingCap: generatorFindingCap(10),
      fileCount: 1,
    });
    const bin = reviewOutputBudgetTokens({
      findingCap: generatorFindingCap(10),
      fileCount: 6,
    });
    expect(bin).toBeGreaterThan(one);
    expect(bin).toBeGreaterThan(OUTPUT_TOKENS_FLOOR);
  });

  it("covers the bin ask that the old flat ceiling could not", () => {
    // Regression: 6 files x 20 findings exceeded the old flat 8192 ceiling.
    expect(
      reviewOutputBudgetTokens({ findingCap: 20, fileCount: 6 }),
    ).toBeGreaterThan(8_192);
  });
});

describe("resolveOutputTokenCeiling", () => {
  it("falls back to the provider default when no budget is stated", () => {
    expect(resolveOutputTokenCeiling(undefined, 65_536, 8_192)).toBe(8_192);
    expect(resolveOutputTokenCeiling(0, 65_536, 8_192)).toBe(8_192);
    expect(resolveOutputTokenCeiling(Number.NaN, 65_536, 8_192)).toBe(8_192);
  });

  it("never drops below the provider default, and never exceeds its max", () => {
    expect(resolveOutputTokenCeiling(1_000, 65_536, 8_192)).toBe(8_192);
    expect(resolveOutputTokenCeiling(20_000, 65_536, 8_192)).toBe(20_000);
    expect(resolveOutputTokenCeiling(999_999, 65_536, 8_192)).toBe(65_536);
    expect(resolveOutputTokenCeiling(20_000, 4_096, 8_192)).toBe(4_096);
  });
});

describe("geminiThinkingBudgetTokens", () => {
  // Thinking shares maxOutputTokens with JSON output, so a higher ceiling must mostly buy answer room.
  it("stays a minority of the ceiling", () => {
    expect(geminiThinkingBudgetTokens(32_768)).toBeLessThan(32_768 / 3);
    expect(geminiThinkingBudgetTokens(8_192)).toBeLessThan(8_192 / 3);
  });

  it("stays inside the band every Gemini 2.5 model accepts", () => {
    // Above 0 (Pro rejects it) and under Flash's 8192 ceiling.
    expect(geminiThinkingBudgetTokens(1_024)).toBeGreaterThanOrEqual(1_024);
    expect(geminiThinkingBudgetTokens(65_536)).toBeLessThanOrEqual(8_192);
  });
});

describe("generatorFindingCap", () => {
  // Bin size intentionally doesn't divide this cap; measured output stays ~3% of ceiling.
  it("is 2x max_comments regardless of how many files share the call", () => {
    expect(generatorFindingCap(10)).toBe(20);
    expect(generatorFindingCap(1)).toBe(2);
  });
});

describe("adaptiveModelTimeoutMs", () => {
  it("uses the base budget for small diffs", () => {
    expect(adaptiveModelTimeoutMs(0)).toBe(MODEL_TIMEOUT_BASE_MS);
    expect(adaptiveModelTimeoutMs(100)).toBe(MODEL_TIMEOUT_BASE_MS);
    expect(adaptiveModelTimeoutMs(undefined)).toBe(MODEL_TIMEOUT_BASE_MS);
    expect(adaptiveModelTimeoutMs(null)).toBe(MODEL_TIMEOUT_BASE_MS);
  });

  it("scales with diff size beyond the free-line allowance", () => {
    expect(adaptiveModelTimeoutMs(200)).toBe(MODEL_TIMEOUT_BASE_MS + 100 * 100);
    expect(adaptiveModelTimeoutMs(250)).toBeGreaterThan(
      adaptiveModelTimeoutMs(150),
    );
  });

  it("caps at the maximum regardless of diff size", () => {
    expect(adaptiveModelTimeoutMs(100_000)).toBe(MODEL_TIMEOUT_MAX_MS);
  });
});

describe("clampTimeoutToChainBudget", () => {
  it("leaves every budget the adaptive ceiling can produce untouched", () => {
    expect(clampTimeoutToChainBudget(MODEL_TIMEOUT_MAX_MS)).toBe(
      MODEL_TIMEOUT_MAX_MS,
    );
    expect(clampTimeoutToChainBudget(MODEL_TIMEOUT_BASE_MS)).toBe(
      MODEL_TIMEOUT_BASE_MS,
    );
  });

  // Chain head is exempt from the budget check, so ceiling must stay <= chain budget.
  it("holds the ceiling under the chain budget", () => {
    expect(MODEL_TIMEOUT_MAX_MS).toBeLessThanOrEqual(
      MODEL_FALLBACK_CHAIN_BUDGET_MS,
    );
    expect(
      clampTimeoutToChainBudget(MODEL_FALLBACK_CHAIN_BUDGET_MS + 10_000),
    ).toBe(MODEL_FALLBACK_CHAIN_BUDGET_MS);
  });
});

describe("ModelCallGate", () => {
  it("never runs more than the limit concurrently and eventually runs everything", async () => {
    const gate = new ModelCallGate(2);
    let active = 0;
    let peak = 0;
    const done: number[] = [];

    const task = (id: number) =>
      gate.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        await Promise.resolve();
        active--;
        done.push(id);
      });

    await Promise.all([task(1), task(2), task(3), task(4), task(5)]);

    expect(peak).toBeLessThanOrEqual(2);
    expect(done).toHaveLength(5);
  });

  it("releases the slot when a gated call rejects", async () => {
    const gate = new ModelCallGate(1);

    await expect(
      gate.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const result = await gate.run(async () => "ok");
    expect(result).toBe("ok");
  });
});
