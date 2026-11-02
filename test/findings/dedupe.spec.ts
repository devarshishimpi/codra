import { describe, expect, it } from "vitest";
import { dedupeFindings } from "@codraoss/core/model-output";
import type { ParsedReviewComment } from "@codraoss/schema";

// Dedupe is a UNION, not a vote. It exists to stop the same finding being posted twice, and it must
// never drop a finding that only one source reported -- in the measured corpus, claims found by seven
// configurations were right 7% of the time against 20% for claims found by one, so agreement is
// evidence against a finding rather than for it.

const comment = (over: Partial<ParsedReviewComment>): ParsedReviewComment => ({
  path: "src/a.ts",
  line: 10,
  position: 1,
  severity: "P2",
  category: "quality",
  title: "Missing null check",
  body: "body",
  anchorHash: "aaaa",
  ...over,
});

describe("dedupeFindings", () => {
  // The bug this fixes: the key was the normalized title alone, so one title collapsed everything that
  // shared it across the whole pull request.
  it("keeps same-titled findings that are in different files", () => {
    const result = dedupeFindings([
      comment({ path: "src/a.ts" }),
      comment({ path: "src/b.ts" }),
      comment({ path: "src/c.ts" }),
    ]);

    expect(result.map((c) => c.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("keeps same-titled findings that are in different places in one file", () => {
    const result = dedupeFindings([
      comment({ line: 10, anchorHash: "aaaa" }),
      comment({ line: 90, anchorHash: "bbbb" }),
    ]);

    expect(result).toHaveLength(2);
  });

  it("collapses the same finding reported twice at the same place", () => {
    const result = dedupeFindings([
      comment({ severity: "P2", confidenceScore: 0.4 }),
      comment({ severity: "P0", confidenceScore: 0.9 }),
    ]);

    expect(result).toHaveLength(1);
    // Most severe wins; confidence breaks a tie.
    expect(result[0].severity).toBe("P0");
  });

  it("breaks a severity tie on confidence", () => {
    const result = dedupeFindings([
      comment({ severity: "P1", confidenceScore: 0.3, body: "lower" }),
      comment({ severity: "P1", confidenceScore: 0.8, body: "higher" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].body).toBe("higher");
  });

  it("treats differently-titled findings at one location as separate", () => {
    const result = dedupeFindings([
      comment({ title: "Missing null check" }),
      comment({ title: "Unbounded loop" }),
    ]);

    expect(result).toHaveLength(2);
  });

  // Title normalization still applies: the same finding phrased two ways is one finding.
  it("collapses titles that differ only in formatting", () => {
    const result = dedupeFindings([
      comment({ title: "Missing null check" }),
      comment({ title: "missing  null-check" }),
    ]);

    expect(result).toHaveLength(1);
  });

  it("leaves the rule channel keyed on its own rule and anchor", () => {
    const rule = (over: Partial<ParsedReviewComment>) =>
      comment({ source: "rule", ruleId: "no-eval", title: "", ...over });

    const result = dedupeFindings([
      rule({ path: "src/a.ts", anchorHash: "aaaa" }),
      rule({ path: "src/a.ts", anchorHash: "aaaa" }),
      rule({ path: "src/b.ts", anchorHash: "aaaa" }),
      rule({ ruleId: "no-with", path: "src/a.ts", anchorHash: "aaaa" }),
    ]);

    expect(result).toHaveLength(3);
  });

  // Nothing to identify it by: merging on location alone would silently drop a distinct finding.
  it("never merges findings with no usable title", () => {
    const result = dedupeFindings([
      comment({ title: "" }),
      comment({ title: "   " }),
    ]);

    expect(result).toHaveLength(2);
  });
});
