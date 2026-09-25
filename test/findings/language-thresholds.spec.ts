import { describe, expect, it } from "vitest";
import { applyFindingGates } from "../../packages/core/src/review/gate-pipeline";
import {
  defaultRepoConfig,
  type ParsedReviewComment,
  type RepoConfig,
} from "@codraoss/schema";

// One global severity/confidence threshold across a corpus where measured precision varies 5.8x by
// language (Go 0.52, Python 0.09) means the bar is wrong for nearly every language at once. These
// cover the per-language override resolving from the finding's own path, so a mixed-language pull
// request is judged file by file.

const env = {
  fileReviews: {
    // No suppression history: this suite is about thresholds, nothing else.
    getSuppressedFindings: async () => [],
  },
} as never;

const job = { id: "job-1" } as never;
const model = {
  verifyFindings: async () => {
    throw new Error("verification unavailable");
  },
};

const comment = (over: Partial<ParsedReviewComment>): ParsedReviewComment => ({
  path: "src/app.ts",
  line: 1,
  position: 1,
  severity: "P3",
  category: "quality",
  title: "A finding",
  body: "body",
  fingerprint: Math.random().toString(36).slice(2),
  ...over,
});

const run = (
  comments: ParsedReviewComment[],
  review: Partial<RepoConfig["review"]> = {},
) =>
  applyFindingGates({
    env,
    job,
    config: {
      ...defaultRepoConfig,
      review: { ...defaultRepoConfig.review, ...review },
    },
    files: [],
    model,
    effectiveMaxComments: 50,
    reviewedComments: comments,
    reviews: [],
  });

describe("per-language gates", () => {
  const python = comment({ path: "src/service.py", title: "Python finding" });
  const go = comment({ path: "src/service.go", title: "Go finding" });

  it("changes nothing when no override is configured", async () => {
    const result = await run([python, go]);

    expect(result.finalComments.map((c) => c.title).sort()).toEqual([
      "Go finding",
      "Python finding",
    ]);
  });

  it("holds one language to a higher severity bar without touching the others", async () => {
    const result = await run([python, go], {
      language_gates: { Python: { min_severity: "P1" } },
    });

    expect(result.finalComments.map((c) => c.title)).toEqual(["Go finding"]);
    expect(result.dispositions.get(python.fingerprint!)).toBe("severity");
  });

  it("matches the language name case-insensitively", async () => {
    const result = await run([python, go], {
      language_gates: { python: { min_severity: "P1" } },
    });

    expect(result.finalComments.map((c) => c.title)).toEqual(["Go finding"]);
  });

  it("applies a per-language confidence floor", async () => {
    const unsure = comment({
      path: "src/service.py",
      title: "Unsure",
      confidenceScore: 0.2,
    });
    const sure = comment({
      path: "src/service.py",
      title: "Sure",
      confidenceScore: 0.9,
    });

    const result = await run([unsure, sure], {
      language_gates: { Python: { min_confidence: 0.5 } },
    });

    expect(result.finalComments.map((c) => c.title)).toEqual(["Sure"]);
    expect(result.dispositions.get(unsure.fingerprint!)).toBe("confidence");
  });

  it("leaves a language with no override on the repo-wide bar", async () => {
    const result = await run([python, go], {
      min_severity: "P1",
      language_gates: { Python: { min_severity: "nit" } },
    });

    // Python relaxed by its override; Go still held to the repo-wide P1.
    expect(result.finalComments.map((c) => c.title)).toEqual([
      "Python finding",
    ]);
  });

  it("ignores an override for a language nothing in the PR is written in", async () => {
    const result = await run([python, go], {
      language_gates: { Rust: { min_severity: "P0" } },
    });

    expect(result.finalComments).toHaveLength(2);
  });
});
