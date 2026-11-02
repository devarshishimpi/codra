import { parseUnifiedDiff } from "@codraoss/core/diff";
import { buildBatchReviewPrompts } from "@codraoss/core/prompts/file-review";
import { applyModelVerifyStyle, VERIFY_SYSTEM_PROMPT } from "@codraoss/core/prompts/verify";
import { compositeRank } from "@codraoss/core";
import { defaultRepoConfig, type RepoConfig } from "@codraoss/schema";

// Line 1 is new code; line 3 is `return computeTotal(items);`, which the diff only moved down from the
// old line 1; the old `const legacyHelper = makeHelper(config);` was removed.
const diff = `diff --git a/src/cart.ts b/src/cart.ts
index 1111111..2222222 100644
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1,4 +1,4 @@
-return computeTotal(items);
-const legacyHelper = makeHelper(config);
+const total = items.length > 0 ? sum(items) : 0;
 export function value() {
+return computeTotal(items);
 }`;
const files = parseUnifiedDiff(diff);

const tuned = (tuning: Partial<NonNullable<RepoConfig["review"]["model_tuning"]>>): RepoConfig["review"] => ({
  ...defaultRepoConfig.review,
  model_tuning: { profile: "test", verify: true, ...tuning },
});

describe("comment cap order", () => {
  it("ranks by severity, then quoted evidence, then confidence", () => {
    const p1 = compositeRank({ severity: "P1", evidence: null, confidenceScore: 0.5 });
    const p2Quoted = compositeRank({ severity: "P2", evidence: "return total;", confidenceScore: 0.9 });
    const p2Bare = compositeRank({ severity: "P2", evidence: null, confidenceScore: 0.9 });
    const p2Unsure = compositeRank({ severity: "P2", evidence: "return total;", confidenceScore: 0.2 });
    expect(p1).toBeLessThan(p2Quoted);
    expect(p2Quoted).toBeLessThan(p2Bare);
    expect(p2Quoted).toBeLessThan(p2Unsure);
  });
});

describe("model prompt styles", () => {
  const prompts = (style?: NonNullable<RepoConfig["review"]["model_tuning"]>["prompt_style"], promptStyle: "auto" | "calibrated" = "auto") =>
    buildBatchReviewPrompts({
      files,
      prTitle: "t",
      prDescription: null,
      config: { ...tuned(style ? { prompt_style: style } : {}), prompt_style: promptStyle },
    });
  const text = (p: { systemPrompt: string; userPrompt: string }) => p.systemPrompt + p.userPrompt;
  const PROHIBITIONS = "You cannot see which files import this one";
  const ASKS_LEAKS = /resource leaks, unhandled failures|unhandled errors, and broken/;

  it("leaves the prompt as built without a style", () => {
    const base = buildBatchReviewPrompts({ files, prTitle: "t", prDescription: null, config: defaultRepoConfig.review });
    expect(prompts()).toEqual(base);
  });

  it.each(["balanced", "trace_then_report"] as const)("%s drops the unseen-code prohibitions and asks for leaks", (style) => {
    const t = text(prompts(style));
    expect(t.includes(PROHIBITIONS)).toBe(false);
    expect(ASKS_LEAKS.test(t)).toBe(true);
    expect(t).toContain("SEVERITY CALIBRATION");
  });

  it("makes the verifier lenient for calibrated and balanced only", () => {
    for (const style of ["calibrated", "balanced"] as const) {
      expect(applyModelVerifyStyle(style, VERIFY_SYSTEM_PROMPT)).not.toBe(VERIFY_SYSTEM_PROMPT);
    }
    for (const style of ["trace_then_report", undefined] as const) {
      expect(applyModelVerifyStyle(style, VERIFY_SYSTEM_PROMPT)).toBe(VERIFY_SYSTEM_PROMPT);
    }
  });
});
