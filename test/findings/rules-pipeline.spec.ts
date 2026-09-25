import { describe, expect, it } from "vitest";
import { dedupeFindings } from "@codraoss/core/model-output";
import {
  ruleHitsToComments,
  scanFileForRuleHits,
} from "@codraoss/core/rules/detect";
import { defaultRepoConfig } from "@codraoss/schema";
import type { FileDiff } from "@codraoss/core/diff";

import { addedLinesFile } from "../mocks/fixtures";
const fileWith = addedLinesFile;

const liveRules = (file: FileDiff) =>
  ruleHitsToComments(file, scanFileForRuleHits(file, { shadowRuleIds: [] }));

describe("the rule channel in the pipeline", () => {
  // The recall argument, stated as a test. If the model returns nothing the deterministic channel
  // must still produce a candidate - otherwise it buys nothing over a better prompt.
  it("produces findings when the LLM produced none", () => {
    const file = fileWith("src/a.ts", ["  } catch (e) {}"]);
    const comments = liveRules(file);

    expect(comments).toHaveLength(1);
    expect(comments[0].source).toBe("rule");
    expect(comments[0].ruleId).toBe("empty-catch");
  });

  it("survives dedupe across files, rather than collapsing on its constant title", () => {
    const a = liveRules(fileWith("src/a.ts", ["  } catch (e) {}"]));
    const b = liveRules(fileWith("src/b.ts", ["  } catch (e) {}"]));

    // Both rule findings carry the identical title. Title-keyed dedupe would leave one.
    expect(a[0].title).toBe(b[0].title);
    expect(dedupeFindings([...a, ...b])).toHaveLength(2);
  });

  // Shadow is the shipping default: every rule scores itself on real pull requests before any of it
  // reaches a reviewer.
  it("defaults every shipped rule to shadow, so nothing posts without a deliberate promotion", () => {
    const file = fileWith("src/a.ts", ["  } catch (e) {}"]);
    const result = scanFileForRuleHits(file, {
      shadowRuleIds: defaultRepoConfig.review.rules.shadow_rule_ids,
    });

    expect(result.stats.shadowHits).toBe(1);
    expect(ruleHitsToComments(file, result)).toEqual([]);
  });
});
