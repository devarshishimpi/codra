import { describe, expect, it } from "vitest";
import { parseFileReviewResponse } from "@codraoss/core/model-output";
import {
  buildAnchorHash,
  buildFindingFingerprint,
  fnv1a32Hex,
  normalizeDiffText,
} from "@codraoss/core/fingerprint";
import type { FileDiff } from "@codraoss/core/diff";

import { reviewJson } from "../mocks/fixtures";
const file: FileDiff = {
  path: "src/app.ts",
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: 5,
  hunks: [
    {
      header: "@@ -1,4 +1,5 @@",
      lines: [
        {
          kind: "context",
          content: "const config = load();",
          newLineNumber: 1,
          position: 1,
        },
        {
          kind: "del",
          content: "const timeout = 30;",
          oldLineNumber: 2,
          position: 2,
        },
        {
          kind: "add",
          content: "const timeout = config.timeout;",
          newLineNumber: 2,
          position: 3,
        },
        {
          kind: "add",
          content: "server.listen(timeout);",
          newLineNumber: 3,
          position: 4,
        },
        { kind: "context", content: "}", newLineNumber: 4, position: 5 },
      ],
    },
  ],
};

// avoid leading severity keywords ('Bug', 'Security'): parser strips them as tags, emptying the title
const review = (finding: Record<string, unknown>) =>
  reviewJson(finding, {
    title: "Unvalidated timeout",
    body: "The timeout value is never checked.",
  });

describe("evidence grounding", () => {
  it("anchors on the quoted line, overriding a wrong reported line number", () => {
    const raw = review({
      evidence: "server.listen(timeout);",
      code_location: { absolute_file_path: "src/app.ts", line: 1 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].line).toBe(3);
  });

  // models sometimes copy renderFileDiff's gutter/marker prefix when quoting verbatim
  it("matches evidence that still carries the rendered gutter and +/- marker", () => {
    const raw = review({
      evidence: "   2    2 +const timeout = config.timeout;",
      code_location: { absolute_file_path: "src/app.ts", line: 2 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].line).toBe(2);
  });

  it("excludes a finding whose evidence appears nowhere in the diff", () => {
    const raw = review({
      evidence: "const retries = getRetryPolicy(config);",
      code_location: { absolute_file_path: "src/app.ts", line: 2 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.comments).toHaveLength(0);
    expect(result.fileSummary).toContain("[unverified:unmatched]");
  });

  // weak/absent used to fall through to line-based anchoring, more lenient than a wrong quote
  it("excludes evidence too short to discriminate", () => {
    const raw = review({
      evidence: "}",
      code_location: { absolute_file_path: "src/app.ts", line: 2 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.comments).toHaveLength(0);
    expect(result.fileSummary).toContain("[unverified:weak]");
    expect(result.evidenceStats.weak).toBe(1);
  });

  it("excludes a finding with no evidence at all", () => {
    const raw = review({
      code_location: { absolute_file_path: "src/app.ts", line: 2 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.comments).toHaveLength(0);
    expect(result.fileSummary).toContain("[unverified:absent]");
    expect(result.evidenceStats.absent).toBe(1);
  });

  // grounding used to be gated on a Cloudflare-only flag, so this never fired on the Google chain
  it("applies every evidence exclusion without reference to the provider", () => {
    const unusable = [
      { evidence: "const retries = getRetryPolicy(config);" },
      { evidence: "}" },
      {},
    ];

    for (const over of unusable) {
      const result = parseFileReviewResponse(
        review({
          ...over,
          code_location: { absolute_file_path: "src/app.ts", line: 2 },
        }),
        file,
      );
      expect(result.comments).toHaveLength(0);
    }
  });

  // models retype rather than copy; curly quotes are the commonest substitution
  it("matches evidence whose quotes and dashes were retyped as typographic characters", () => {
    const quoteFile: FileDiff = {
      ...file,
      hunks: [
        {
          header: "@@ -1,1 +1,1 @@",
          lines: [
            {
              kind: "add",
              content: "const mode = 'fast-path';",
              newLineNumber: 1,
              position: 1,
            },
          ],
        },
      ],
    };

    const raw = review({
      evidence: "const mode = ‘fast—path’;",
      code_location: { absolute_file_path: "src/app.ts", line: 1 },
    });

    const result = parseFileReviewResponse(raw, quoteFile);
    expect(result.comments).toHaveLength(1);
    expect(result.evidenceStats.matched).toBe(1);
  });

  // findPositionForLine rejects `del` lines, so a quote of removed code must not anchor there
  it("does not anchor to a deleted line", () => {
    const raw = review({
      evidence: "const timeout = 30;",
      code_location: { absolute_file_path: "src/app.ts", line: 2 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].line).toBe(2);
  });

  // regression: 4 hallucinated hook findings anchored by containing a bare ") => {" diff line
  it("does not anchor a fabricated quote to a short punctuation-only diff line", () => {
    const braceFile: FileDiff = {
      ...file,
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          lines: [
            { kind: "add", content: "  ) => {", newLineNumber: 1, position: 1 },
            {
              kind: "add",
              content: "  const timeout = config.timeout;",
              newLineNumber: 2,
              position: 2,
            },
          ],
        },
      ],
    };

    const raw = review({
      evidence: "useEffect(() => {",
      code_location: { absolute_file_path: "src/app.ts", line: 1 },
    });

    const result = parseFileReviewResponse(raw, braceFile);
    expect(result.comments).toHaveLength(0);
    expect(result.evidenceStats.unmatched).toBe(1);
  });

  it("still accepts a genuine fragment of a substantial line", () => {
    const raw = review({
      evidence: "server.listen(timeout)",
      code_location: { absolute_file_path: "src/app.ts", line: 3 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].line).toBe(3);
  });

  it("reports evidence match statistics for observability", () => {
    const raw = review({
      evidence: "server.listen(timeout);",
      code_location: { absolute_file_path: "src/app.ts", line: 3 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.evidenceStats).toMatchObject({
      total: 1,
      matched: 1,
      unmatched: 0,
    });
  });

  // gate only fires on typeof === 'number', so undefined would bypass a threshold 0.1 would fail
  it("scores a missing confidence as 0 rather than leaving it unset", () => {
    const raw = JSON.stringify({
      findings: [
        {
          title: "Unvalidated timeout",
          body: "The timeout value is never checked.",
          priority: 1,
          evidence: "server.listen(timeout);",
          code_location: { absolute_file_path: "src/app.ts", line: 3 },
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "explanation",
    });

    expect(parseFileReviewResponse(raw, file).comments[0].confidenceScore).toBe(
      0,
    );
  });

  it("maps priority 4 to nit so the severity gate has something to act on", () => {
    const raw = review({
      priority: 4,
      evidence: "server.listen(timeout);",
      code_location: { absolute_file_path: "src/app.ts", line: 3 },
    });

    const result = parseFileReviewResponse(raw, file);
    expect(result.comments[0].severity).toBe("nit");
  });

  // deliberately not 'nit': priority is just metadata, discarding a real P0 for a missing int is bad
  it("defaults a missing priority to P3, not nit", () => {
    const raw = JSON.stringify({
      findings: [
        {
          title: "Unvalidated timeout",
          body: "The timeout value is never checked.",
          confidence_score: 0.9,
          evidence: "server.listen(timeout);",
          code_location: { absolute_file_path: "src/app.ts", line: 3 },
        },
      ],
      overall_correctness: "patch is incorrect",
      overall_explanation: "explanation",
    });

    expect(parseFileReviewResponse(raw, file).comments[0].severity).toBe("P3");
  });
});

describe("fingerprints", () => {
  // pinned, not self-compared: these hashes live in review_comments and are matched across runs
  it("produces stable hashes across releases", () => {
    expect(fnv1a32Hex("hello")).toBe("4f9f2cab");
    expect(fnv1a32Hex("hellp")).toBe("5c9f4122");
  });

  it("strips the rendered diff gutter and collapses whitespace", () => {
    expect(normalizeDiffText("   2    2 +const a = 1;")).toBe("const a = 1;");
    expect(normalizeDiffText("  const   a  =  1;  ")).toBe("const a = 1;");
  });

  // reindentation must not re-raise the finding
  it("anchor hash ignores whitespace-only changes", () => {
    expect(buildAnchorHash("  const a = 1;")).toBe(
      buildAnchorHash("const   a = 1;"),
    );
  });

  // but a genuine code edit must re-raise it
  it("anchor hash changes when the code changes", () => {
    expect(buildAnchorHash("const a = 1;")).not.toBe(
      buildAnchorHash("const a = 2;"),
    );
  });

  it("fingerprint is scoped per path and stable across title formatting", () => {
    expect(buildFindingFingerprint("a.ts", "Missing null check")).toBe(
      buildFindingFingerprint("a.ts", "missing  null-check"),
    );
    expect(buildFindingFingerprint("a.ts", "Missing null check")).not.toBe(
      buildFindingFingerprint("b.ts", "Missing null check"),
    );
  });
});
