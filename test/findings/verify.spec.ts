import {
  parseVerifyResponse,
  renderDiffSnippet,
  buildVerifyPrompt,
  type VerifyCandidate,
} from "@codraoss/core/prompts/verify";
import type { FileDiff } from "@codraoss/core/diff";

const file: FileDiff = {
  path: "src/foo.ts",
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: 6,
  hunks: [
    {
      header: "@@ -1,6 +1,6 @@",
      lines: [
        {
          kind: "context",
          content: "const a = 1;",
          newLineNumber: 1,
          position: 1,
        },
        {
          kind: "context",
          content: "const b = 2;",
          newLineNumber: 2,
          position: 2,
        },
        {
          kind: "add",
          content: "const c = a + b;",
          newLineNumber: 3,
          position: 3,
        },
        { kind: "add", content: "return c;", newLineNumber: 4, position: 4 },
        { kind: "context", content: "}", newLineNumber: 5, position: 5 },
      ],
    },
  ],
};

describe("parseVerifyResponse", () => {
  it("parses a clean JSON verdict list", () => {
    const raw =
      '{"results":[{"index":0,"verdict":"keep","confidence":0.9},{"index":1,"verdict":"drop"}]}';
    const results = parseVerifyResponse(raw);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ index: 0, verdict: "keep" });
    expect(results[1]).toMatchObject({ index: 1, verdict: "drop" });
  });

  it("extracts JSON surrounded by prose", () => {
    const raw =
      'Sure, here you go:\n{"results":[{"index":2,"verdict":"drop"}]}\nDone.';
    const results = parseVerifyResponse(raw);
    expect(results).toEqual([{ index: 2, verdict: "drop" }]);
  });

  it("repairs slightly malformed JSON", () => {
    const raw = '{"results":[{"index":0,"verdict":"keep",},]}';
    const results = parseVerifyResponse(raw);
    expect(results[0].verdict).toBe("keep");
  });

  it("throws on completely unparseable output (caller falls back)", () => {
    expect(() => parseVerifyResponse("not json at all")).toThrow();
  });
});

describe("renderDiffSnippet", () => {
  it("renders a window around the target line with +/- prefixes", () => {
    const snippet = renderDiffSnippet(file, 3, 1);
    expect(snippet).toContain("+const c = a + b;");
    expect(snippet).toContain("const b = 2;");
  });

  it("returns empty string when the file is missing", () => {
    expect(renderDiffSnippet(undefined, 3)).toBe("");
  });

  // It used to fall back to the top of the file's diff, judging the claim against unrelated code.
  // Returning nothing instead lets the caller pass the candidate through unverified.
  it("returns empty string when the line cannot be located", () => {
    expect(renderDiffSnippet(file, 999, 1)).toBe("");
  });

  it("returns empty string when no line is supplied", () => {
    expect(renderDiffSnippet(file, undefined, 1)).toBe("");
  });
});

describe("buildVerifyPrompt", () => {
  it("includes every candidate index and its claim", () => {
    const candidates: VerifyCandidate[] = [
      {
        index: 0,
        path: "src/foo.ts",
        line: 3,
        title: "Bug",
        body: "It breaks",
        snippet: "snip",
      },
    ];
    const prompt = buildVerifyPrompt(candidates);
    expect(prompt).toContain("Finding index 0");
    expect(prompt).toContain("It breaks");
    expect(prompt).toContain("src/foo.ts:3");
  });
});
