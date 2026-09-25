import { describe, expect, it } from "vitest";
import { parseBatchReviewResponse } from "@codraoss/core/model-output";
import type { FileDiff } from "@codraoss/core/diff";

function file(
  path: string,
  contents: string[],
  previousPath: string | null = null,
): FileDiff {
  return {
    path,
    previousPath,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount: contents.length,
    hunks: [
      {
        header: "@@ -1,10 +1,10 @@",
        lines: contents.map((content, i) => ({
          kind: "add" as const,
          content,
          newLineNumber: i + 1,
          oldLineNumber: undefined,
          position: i + 1,
        })),
      },
    ],
  };
}

function entry(path: string, evidence: string, title = "Something is wrong") {
  return {
    absolute_file_path: path,
    findings: [
      {
        evidence,
        code_location: { absolute_file_path: path, line: 1 },
        claim_type: "other",
        title,
        body: "A concrete problem with a concrete impact.",
        priority: 2,
      },
    ],
    overall_explanation: `Summary for ${path}`,
    overall_correctness: "patch is incorrect",
  };
}

const raw = (files: unknown[]) =>
  JSON.stringify({ files, overall_confidence_score: 0.6 });

describe("parseBatchReviewResponse", () => {
  it("routes each entry to its own file, and reports one the model omitted", () => {
    const files = [
      file("src/a.ts", ["const alpha = computeAlpha();"]),
      file("src/b.ts", ["const bravo = computeBravo();"]),
      file("src/c.ts", ["const charlie = 3;"]),
    ];

    const result = parseBatchReviewResponse(
      raw([
        entry("src/a.ts", "const alpha = computeAlpha();"),
        entry("src/b.ts", "const bravo = computeBravo();"),
      ]),
      files,
    );

    expect(result.reviews.get("src/a.ts")!.comments[0].path).toBe("src/a.ts");
    expect(result.reviews.get("src/b.ts")!.comments[0].path).toBe("src/b.ts");
    expect(result.reviews.get("src/a.ts")!.fileSummary).toContain(
      "Summary for src/a.ts",
    );
    // Omitted file must surface for re-queueing, not silently approved.
    expect(result.missing).toEqual(["src/c.ts"]);
    expect(result.reviews.has("src/c.ts")).toBe(false);
  });

  // Renames matter: renderFileDiff shows the old path on the header line.
  it("tolerates path noise and renames, but refuses to guess", () => {
    for (const reported of [
      "./src/a.ts",
      "a/src/a.ts",
      "b/src/a.ts",
      "/src/a.ts",
      "a.ts",
    ]) {
      const result = parseBatchReviewResponse(
        raw([entry(reported, "const alpha = 1;")]),
        [file("src/a.ts", ["const alpha = 1;"])],
      );
      expect(result.stats.unroutableEntries).toBe(0);
      expect(result.reviews.get("src/a.ts")!.comments).toHaveLength(1);
    }

    const renamed = parseBatchReviewResponse(
      raw([entry("src/old.ts", "const alpha = 1;")]),
      [file("src/new.ts", ["const alpha = 1;"], "src/old.ts")],
    );
    expect(renamed.reviews.get("src/new.ts")!.comments).toHaveLength(1);

    // Shared basename: guessing would misattribute findings.
    const siblings = [
      file("src/a/index.ts", ["const alpha = 1;"]),
      file("src/b/index.ts", ["const bravo = 2;"]),
    ];
    const ambiguous = parseBatchReviewResponse(
      raw([entry("index.ts", "const alpha = 1;")]),
      siblings,
    );
    expect(ambiguous.stats.unroutableEntries).toBe(1);
    expect(ambiguous.reviews.size).toBe(0);

    const duplicated = parseBatchReviewResponse(
      raw([
        entry("src/a/index.ts", "const alpha = 1;"),
        entry("src/a/index.ts", "const alpha = 1;", "Duplicate"),
      ]),
      siblings,
    );
    expect(duplicated.stats.unroutableEntries).toBe(1);
    expect(duplicated.reviews.get("src/a/index.ts")!.comments).toHaveLength(1);
    expect(duplicated.missing).toEqual(["src/b/index.ts"]);
  });

  // Per-file indexes miss quotes shared across files.
  it("withholds only when a shared quote AND a path disagreement coincide", () => {
    const shared = "} catch (error) {";
    const files = [
      file("src/a.ts", [shared, "const uniqueToAlpha = 1;"]),
      file("src/b.ts", [shared, "const bravo = 2;"]),
    ];
    const misfiled = (evidence: string, claimedPath: string) =>
      raw([
        {
          absolute_file_path: "src/a.ts",
          findings: [
            {
              evidence,
              code_location: { absolute_file_path: claimedPath, line: 1 },
              claim_type: "other",
              title: "Swallowed error",
              body: "The catch block hides the failure.",
              priority: 1,
            },
          ],
          overall_explanation: "Summary",
          overall_correctness: "patch is incorrect",
        },
      ]);

    const withheld = parseBatchReviewResponse(
      misfiled(shared, "src/b.ts"),
      files,
    );
    expect(withheld.stats.ambiguousAcrossBin).toBe(1);
    expect(withheld.reviews.get("src/a.ts")!.comments).toHaveLength(0);

    const agreeing = parseBatchReviewResponse(
      raw([entry("src/a.ts", shared, "Swallowed error")]),
      files,
    );
    expect(agreeing.stats.ambiguousAcrossBin).toBe(0);
    expect(agreeing.reviews.get("src/a.ts")!.comments).toHaveLength(1);

    // Unique quote + wrong path: enclosing entry still wins.
    const mismatch = parseBatchReviewResponse(
      misfiled("const uniqueToAlpha = 1;", "src/b.ts"),
      files,
    );
    expect(mismatch.stats.pathMismatchFindings).toBe(1);
    expect(mismatch.reviews.get("src/a.ts")!.comments[0].path).toBe("src/a.ts");
  });

  // Cap is per-file: a noisy file keeps its own cap while others are untouched.
  it("trims over-cap findings per file and accounts for the drop", () => {
    const lines = Array.from(
      { length: 30 },
      (_, i) => `const value${i} = ${i};`,
    );
    const files = [
      file("src/a.ts", lines),
      file("src/b.ts", ["const bravo = 2;"]),
    ];

    const noisy = {
      absolute_file_path: "src/a.ts",
      findings: lines.map((line, i) => ({
        evidence: line,
        code_location: { absolute_file_path: "src/a.ts", line: i + 1 },
        claim_type: "other",
        title: `Problem number ${i}`,
        body: "A concrete problem with a concrete impact.",
        priority: 2,
      })),
      overall_explanation: "Many problems",
      overall_correctness: "patch is incorrect",
    };

    const result = parseBatchReviewResponse(
      raw([
        noisy,
        entry("src/b.ts", "const bravo = 2;", "Bravo is off by one"),
      ]),
      files,
      { maxCommentsPerFile: 5 },
    );

    // generatorFindingCap(5) = 10.
    expect(result.reviews.get("src/a.ts")!.comments).toHaveLength(10);
    expect(result.stats.overCap).toBe(20);
    expect(result.reviews.get("src/a.ts")!.fileSummary).toContain("over-cap");
    expect(result.reviews.get("src/b.ts")!.comments).toHaveLength(1);
  });

  // One bad finding must not sink the rest of the batch.
  it("drops an unassemblable finding without losing the rest of the bin", () => {
    const files = [
      file("src/a.ts", ["const alpha = 1;"]),
      file("src/b.ts", ["const bravo = 2;"]),
    ];

    const result = parseBatchReviewResponse(
      raw([
        {
          absolute_file_path: "src/a.ts",
          findings: [
            {
              evidence: "const alpha = 1;",
              code_location: { absolute_file_path: "src/a.ts", line: 1 },
              claim_type: "other",
              // Title is a prefix of the body, so the body is stripped to nothing downstream.
              title: "Leak",
              body: "Leak",
              priority: 2,
            },
          ],
          overall_explanation: "Summary",
          overall_correctness: "patch is incorrect",
        },
        entry("src/b.ts", "const bravo = 2;", "Bravo is off by one"),
      ]),
      files,
    );

    expect(result.reviews.get("src/a.ts")!.comments).toHaveLength(0);
    expect(result.reviews.get("src/a.ts")!.fileSummary).toContain(
      "unassemblable",
    );
    expect(result.reviews.get("src/b.ts")!.comments).toHaveLength(1);
  });
});
