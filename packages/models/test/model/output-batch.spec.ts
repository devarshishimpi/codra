import { describe, expect, it } from "vitest";
import { parseRawBatchPayload } from "@codraoss/core/model-output";

function nested(paths: string[]) {
  return {
    files: paths.map((path, i) => ({
      absolute_file_path: path,
      findings: [
        {
          evidence: `const value${i} = 1;`,
          code_location: { absolute_file_path: path, line: i + 1 },
          claim_type: "other",
          title: `Finding in ${path}`,
          body: "Body text.",
          priority: 2,
        },
      ],
      overall_explanation: `Summary for ${path}`,
      overall_correctness: "patch is incorrect",
    })),
    overall_confidence_score: 0.7,
  };
}

describe("parseRawBatchPayload", () => {
  // Anchoring on the first `"findings"` lands on files[0]'s brace, dropping every other file.
  it("recovers every file, bare or fenced, with per-file verdict and summary intact", () => {
    const payload = nested(["src/a.ts", "src/b.ts", "src/c.ts"]);
    payload.files[0].overall_correctness = "patch is correct";
    payload.files[0].overall_explanation = "Nothing wrong here";

    const bare = parseRawBatchPayload(JSON.stringify(payload));
    if (bare.shape !== "nested") throw new Error("expected nested");
    expect(bare.data.files.map((f) => f.absolute_file_path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    expect(bare.data.files[0].overall_correctness).toBe("patch is correct");
    expect(bare.data.files[0].overall_explanation).toBe("Nothing wrong here");
    expect(bare.data.files[1].overall_correctness).toBe("patch is incorrect");

    const fenced = parseRawBatchPayload(
      `Here is my review:\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n\nLet me know.`,
    );
    if (fenced.shape !== "nested") throw new Error("expected nested");
    expect(fenced.data.files).toHaveLength(3);
  });

  // A truncated response repairs into JSON whose last entry has no `findings` key, so defaulting to
  // [] would approve unexamined code. An explicit [] is honoured.
  it("drops an entry with no findings key, but keeps an explicitly empty one", () => {
    const complete = nested(["src/a.ts"]).files[0];
    const truncated = parseRawBatchPayload(
      `{"files":[${JSON.stringify(complete)},{"absolute_file_path":"src/b.ts"`,
    );
    if (truncated.shape !== "nested") throw new Error("expected nested");
    expect(truncated.data.files.map((f) => f.absolute_file_path)).toEqual([
      "src/a.ts",
    ]);

    const empty = parseRawBatchPayload(
      JSON.stringify({
        files: [
          {
            absolute_file_path: "src/a.ts",
            findings: [],
            overall_correctness: "patch is correct",
          },
        ],
      }),
    );
    if (empty.shape !== "nested") throw new Error("expected nested");
    expect(empty.data.files[0].findings).toEqual([]);
  });

  // A weak fallback model emits the single-file shape; without recovery the whole bin is unreviewed.
  it("falls back to the flat shape, and throws when nothing is recognisable", () => {
    const flat = parseRawBatchPayload(
      JSON.stringify({
        findings: [
          {
            evidence: "const x = 1;",
            code_location: { absolute_file_path: "src/a.ts", line: 3 },
            claim_type: "other",
            title: "Flat finding",
            body: "Body.",
            priority: 1,
          },
        ],
        overall_correctness: "patch is incorrect",
        overall_explanation: "Flat summary",
      }),
    );
    expect(flat.shape).toBe("flat");
    if (flat.shape !== "flat") throw new Error("unreachable");
    expect(flat.data.findings[0].code_location.absolute_file_path).toBe(
      "src/a.ts",
    );

    // Must throw, not resolve empty: the throw falls to the next model in the chain.
    expect(() =>
      parseRawBatchPayload("I could not review this code."),
    ).toThrow();
    expect(() => parseRawBatchPayload(JSON.stringify({ files: [] }))).toThrow();
    expect(() =>
      parseRawBatchPayload(JSON.stringify({ files: [{ no_path_here: true }] })),
    ).toThrow();
  });
});
