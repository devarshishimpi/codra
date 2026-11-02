import { describe, expect, it } from "vitest";
import {
  scanFileForRuleHits,
  ruleHitsToComments,
} from "@codraoss/core/rules/detect";
import { RULES } from "@codraoss/core/rules/table";
import {
  CLAIM_TYPE_DECIDABILITY,
  DEFAULT_SHADOW_RULE_IDS,
} from "@codraoss/schema";

import { addedLinesFile } from "../mocks/fixtures";

// Every rule gets a true positive AND a fixture for each false-positive route it must survive:
// a comment, a string literal, a removed line -- the three ways a regex over a diff usually goes wrong.
const fileWith = addedLinesFile;

const scan = (path: string, added: string[], removed: string[] = []) =>
  scanFileForRuleHits(fileWith(path, added, removed), { shadowRuleIds: [] });

const ruleIds = (path: string, added: string[], removed: string[] = []) =>
  scan(path, added, removed).hits.map((h) => h.rule.id);

describe("rule table invariants", () => {
  // A rule whose claim type is denied downstream would generate candidates that can never post.
  it("only uses claim types decidable from the diff alone", () => {
    for (const rule of RULES) {
      expect(CLAIM_TYPE_DECIDABILITY[rule.claimType], rule.id).toBe(
        "diff_local",
      );
    }
  });

  // Without this, adding a rule to the table and forgetting the shadow list posts it live on the
  // next deploy. That is the one mistake in this file with no other backstop.
  it("ships every rule in shadow, including the disabled ones", () => {
    for (const rule of RULES) {
      expect(DEFAULT_SHADOW_RULE_IDS as readonly string[], rule.id).toContain(
        rule.id,
      );
    }
  });
});

describe("regex matches", () => {
  it.each([
    ["empty-catch", "  } catch (e) {}", true],
    ["empty-catch", "  } catch {}", true],
    ["empty-catch", "  } catch (e) { /* intentional: probe only */ }", false],
    ["dynamic-html-sink", "  el.innerHTML = userHtml;", true],
    ["dynamic-html-sink", "  el.innerHTML = '';", false],
    ["dynamic-html-sink", '  el.innerHTML = "<br>";', false],
    ["destructive-migration", "ALTER TABLE jobs DROP COLUMN legacy_id;", true],
    ["destructive-migration", "DROP TABLE old_reviews;", true],
    ["destructive-migration", "TRUNCATE TABLE staging;", true],
    ["destructive-migration", "DROP INDEX IF EXISTS jobs_idx;", false],
    [
      "destructive-migration",
      "ALTER TABLE jobs ALTER COLUMN x DROP NOT NULL;",
      false,
    ],
    [
      "destructive-migration",
      "ALTER TABLE jobs ALTER COLUMN x DROP DEFAULT;",
      false,
    ],
  ])("%s fires correctly for %s", (ruleId, line, shouldMatch) => {
    const filename = ruleId === "destructive-migration" ? "m.sql" : "a.ts";
    if (shouldMatch) {
      expect(ruleIds(filename, [line])).toContain(ruleId);
    } else {
      expect(ruleIds(filename, [line])).not.toContain(ruleId);
    }
  });
});

describe("cross-cutting suppressions", () => {
  it("honours the denied claim types and the disabled list", () => {
    const file = fileWith("a.ts", ["  } catch (e) {}"]);
    expect(
      scanFileForRuleHits(file, { deniedClaimTypes: ["swallowed_error"] }).hits,
    ).toEqual([]);
    expect(
      scanFileForRuleHits(file, { disabledRuleIds: ["empty-catch"] }).hits,
    ).toEqual([]);
  });

  it("reports shadow hits separately and produces no comment for them", () => {
    const file = fileWith("a.ts", ["  } catch (e) {}"]);
    const result = scanFileForRuleHits(file, {
      shadowRuleIds: ["empty-catch"],
    });
    expect(result.stats.shadowHits).toBe(1);
    expect(result.stats.hits).toBe(0);
    expect(ruleHitsToComments(file, result)).toEqual([]);
  });
});
