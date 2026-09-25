import {
  parseFileReviewResponse,
  dedupeFindings,
} from "@codraoss/core/model-output";
import type { FileDiff } from "@codraoss/core/diff";
import type { ParsedReviewComment } from "@codraoss/schema";

describe("Model Output Parsing Deep Dive", () => {
  const mockFile: FileDiff = {
    path: "test.ts",
    previousPath: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount: 10,
    hunks: [
      {
        header: "@@ -1,5 +1,5 @@",
        lines: [
          { kind: "context", content: "older", newLineNumber: 1, position: 1 },
          { kind: "add", content: "new line", newLineNumber: 2, position: 2 },
          { kind: "context", content: "older", newLineNumber: 3, position: 3 },
        ],
      },
    ],
  };

  it("extracts JSON from markdown code blocks with surrounding text", () => {
    const rawOutput = `
Here is my review:
\`\`\`json
{
  "findings": [{
    "title": "Good code",
    "body": "This looks fine.",
    "priority": 2,
    "evidence": "new line",
    "code_location": { "absolute_file_path": "test.ts", "line": 2 }
  }],
  "overall_correctness": "patch is correct",
  "overall_explanation": "All good"
}
\`\`\`
Hope this helps!`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    expect(result.comments).toHaveLength(1);
    expect(result.verdict).toBe("comment");
  });

  it("salvages malformed JSON with unescaped newlines using jsonrepair", () => {
    const rawOutput = `
{
  "findings": [{
    "title": "Multiline
Issue",
    "body": "This has
unescaped newlines",
    "priority": 1,
    "evidence": "new line",
    "code_location": { "absolute_file_path": "test.ts", "line": 2 }
  }],
  "overall_correctness": "issues found",
  "overall_explanation": "explanation"
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    // our cleanText flattens newlines in titles to spaces
    expect(result.comments[0].title).toBe("Multiline Issue");
  });

  it("removes conversational tags and emojis from titles and bodies", () => {
    const rawOutput = `
{
  "findings": [{
    "title": "🚀 [PERFORMANCE] Optimization needed",
    "body": "⚠️ HIGH: You should optimize this.",
    "priority": 0,
    "evidence": "new line",
    "code_location": { "absolute_file_path": "test.ts", "line": 2 }
  }],
  "overall_correctness": "issues found",
  "overall_explanation": "explanation"
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    expect(result.comments[0].title).toBe("Optimization needed");
  });

  // The matched quote is the anchor, so a wrong reported line must not move the comment.
  it("anchors on the quoted line and ignores a wrong reported line number", () => {
    const rawOutput = `
{
  "findings": [{
    "title": "Off-target",
    "body": "Targeting line 5",
    "priority": 2,
    "evidence": "new line",
    "code_location": { "absolute_file_path": "test.ts", "line": 5 }
  }],
  "overall_correctness": "issues found",
  "overall_explanation": "explanation"
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    expect(result.comments[0].line).toBe(2);
  });

  it("drops a finding whose line is far outside the diff instead of relocating it", () => {
    const rawOutput = `
{
  "findings": [{
    "title": "Hallucinated location",
    "body": "Targeting line 80",
    "priority": 2,
    "code_location": { "absolute_file_path": "test.ts", "line": 80 }
  }],
  "overall_correctness": "issues found",
  "overall_explanation": "explanation"
}`;

    // A line this far out means the model was reasoning about code that isn't here.
    const result = parseFileReviewResponse(rawOutput, mockFile);
    expect(result.comments).toHaveLength(0);
    expect(result.fileSummary).toContain("Additional Comments (Off-diff)");
  });

  // `z.string().max(100)` on `title` rejects the whole file's review, not the one finding.
  it("clips an over-long or non-string title instead of failing the whole file", () => {
    const rawOutput = JSON.stringify({
      findings: [
        {
          evidence: "new line",
          code_location: { absolute_file_path: "test.ts", line: 2 },
          claim_type: "other",
          title: "T".repeat(150),
          body: "Long title finding.",
          priority: 1,
        },
        {
          evidence: "new line",
          code_location: { absolute_file_path: "test.ts", line: 2 },
          claim_type: "other",
          title: 42,
          body: "Non-string title finding.",
          priority: 1,
        },
        {
          evidence: "new line",
          code_location: { absolute_file_path: "test.ts", line: 2 },
          claim_type: "other",
          title: "Healthy sibling",
          body: "This one is well formed.",
          priority: 1,
        },
      ],
      overall_correctness: "patch is correct",
      overall_explanation: "ok",
      overall_confidence_score: 0.9,
    });

    const result = parseFileReviewResponse(rawOutput, mockFile);

    // The invariant: one malformed title must not take its well-formed siblings down with it.
    expect(result.comments).toHaveLength(3);
    for (const comment of result.comments) {
      expect(comment.title.length).toBeLessThanOrEqual(100);
    }
    expect(result.comments[1].title).toBe("42");
    expect(result.comments[2].title).toBe("Healthy sibling");
  });

  it("drops placeholder schema findings instead of failing validation", () => {
    const rawOutput = `
{
  "findings": [{
    "title": "<Plain title>",
    "body": "<Technical explanation>",
    "priority": "<0|1|2|3>",
    "code_location": {
      "absolute_file_path": "test.ts",
      "line": "<int>",
      "line_range": { "start": "<int>", "end": "<int>" }
    }
  }],
  "overall_correctness": "patch is correct",
  "overall_explanation": "No concrete findings",
  "overall_confidence_score": 0.5
}`;

    const result = parseFileReviewResponse(rawOutput, mockFile);
    expect(result.comments).toHaveLength(0);
    expect(result.verdict).toBe("approve");
  });
});

describe("dedupeFindings", () => {
  const make = (over: Partial<ParsedReviewComment>): ParsedReviewComment => ({
    path: "a.ts",
    line: 1,
    position: 1,
    severity: "P2",
    category: "quality",
    title: "Use of any",
    body: "body",
    ...over,
  });

  // This used to assert the opposite, and the opposite was a bug: the key was the normalized title
  // alone, so "Use of any" in three files became one comment and two real findings were dropped.
  // Dedupe is a union over locations, not a merge of everything that happens to share a name.
  it("keeps same-titled findings that are in different files", () => {
    const result = dedupeFindings([
      make({ path: "a.ts", severity: "P3", confidenceScore: 0.4 }),
      make({ path: "b.ts", severity: "P1", confidenceScore: 0.5 }),
      make({ path: "c.ts", severity: "P3", confidenceScore: 0.9 }),
    ]);

    expect(result.map((c) => c.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("collapses the same finding at the same place, keeping the strongest", () => {
    const result = dedupeFindings([
      make({ severity: "P3", confidenceScore: 0.4, anchorHash: "aaaa" }),
      make({ severity: "P1", confidenceScore: 0.5, anchorHash: "aaaa" }),
      make({ severity: "P3", confidenceScore: 0.9, anchorHash: "aaaa" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("P1");
  });
});
