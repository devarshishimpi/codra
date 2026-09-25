import { describe, expect, it } from "vitest";
import { parseFileReviewResponse } from "@codraoss/core/model-output";
import { DEFAULT_DENIED_CLAIM_TYPES } from "@codraoss/schema";
import type { FileDiff } from "@codraoss/core/diff";

// Regression over the full parse chain (JSON extraction, grounding, denylist, labels, fingerprints), one pass.
// Replaces a 3.4MB corpus that caught regressions without naming the broken behavior. Not an accuracy benchmark; see comment_feedback for that.

const file: FileDiff = {
  path: "src/server/db/stats.ts",
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: 8,
  hunks: [
    {
      header: "@@ -10,4 +10,8 @@",
      lines: [
        {
          kind: "context",
          content: "export async function getStats(env: Env, tz: string) {",
          newLineNumber: 10,
          oldLineNumber: 10,
          position: 1,
        },
        {
          kind: "add",
          content:
            "  const rows = await sql`SELECT * FROM jobs WHERE tz = ${tz}`;",
          newLineNumber: 11,
          position: 2,
        },
        {
          kind: "add",
          content: "  try { await refresh(); } catch (e) {}",
          newLineNumber: 12,
          position: 3,
        },
        {
          kind: "add",
          content: "  uses: actions/checkout@v7",
          newLineNumber: 13,
          position: 4,
        },
        {
          kind: "add",
          content: "  return rows;",
          newLineNumber: 14,
          position: 5,
        },
        {
          kind: "context",
          content: "}",
          newLineNumber: 15,
          oldLineNumber: 11,
          position: 6,
        },
      ],
    },
  ],
};

// Six findings, each dropped by a different gate; markdown-fenced like real model output.
const response = `Here is my review.

\`\`\`json
{
  "findings": [
    {
      "evidence": "try { await refresh(); } catch (e) {}",
      "code_location": { "absolute_file_path": "src/server/db/stats.ts", "line": 12 },
      "claim_type": "swallowed_error",
      "title": "Empty catch swallows the refresh failure",
      "body": "The catch block discards the error with no log and no rethrow.",
      "priority": 2
    },
    {
      "evidence": "const rows = await sql\`SELECT * FROM jobs WHERE tz = \${tz}\`;",
      "code_location": { "absolute_file_path": "src/server/db/stats.ts", "line": 11 },
      "claim_type": "react_hook_missing_deps",
      "title": "Missing hook dependency",
      "body": "A claim type that cannot be decided from a diff hunk.",
      "priority": 2
    },
    {
      "evidence": "uses: actions/checkout@v7",
      "code_location": { "absolute_file_path": "src/server/db/stats.ts", "line": 13 },
      "claim_type": "other",
      "title": "Invalid GitHub Action version",
      "body": "actions/checkout@v7 does not exist; the latest release is v4.",
      "priority": 0
    },
    {
      "evidence": "const cached = await redis.get(cacheKey);",
      "code_location": { "absolute_file_path": "src/server/db/stats.ts", "line": 11 },
      "claim_type": "resource_leak",
      "title": "Unclosed Redis connection",
      "body": "Field-perfect, and about a line that does not exist in this diff.",
      "priority": 1
    },
    {
      "evidence": "}",
      "code_location": { "absolute_file_path": "src/server/db/stats.ts", "line": 15 },
      "claim_type": "other",
      "title": "Brace placement",
      "body": "Evidence too short to discriminate between dozens of lines.",
      "priority": 3
    },
    {
      "code_location": { "absolute_file_path": "src/server/db/stats.ts", "line": 11 },
      "claim_type": "sql_injection",
      "title": "Unparameterised timezone interpolation",
      "body": "No evidence field at all, despite the prompt demanding one in four places.",
      "priority": 0
    }
  ],
  "overall_explanation": "Several issues found.",
  "overall_correctness": "patch is incorrect",
  "overall_confidence_score": 0.9
}
\`\`\``;

describe("the parse-time chain, composed", () => {
  const parsed = parseFileReviewResponse(response, file, {
    deniedClaimTypes: DEFAULT_DENIED_CLAIM_TYPES,
  });

  // Asserts the surviving title, not a count, so a broken gate shows up specifically.
  it("surfaces only the finding that is both grounded and decidable", () => {
    expect(parsed.comments.map((c) => c.title)).toEqual([
      "Empty catch swallows the refresh failure",
    ]);
  });

  it("withholds the three findings whose evidence does not resolve", () => {
    // unmatched: off-diff quote. weak: `}` matches many lines. absent: no evidence field.
    // matched=3 (not 1): grounding runs before the denylist, so denied findings still resolve.
    expect(parsed.evidenceStats).toMatchObject({
      total: 6,
      matched: 3,
      unmatched: 1,
      weak: 1,
      absent: 1,
    });
  });

  it("denies the claim types that cannot be decided from a diff hunk", () => {
    expect(parsed.deniedClaimCounts.react_hook_missing_deps).toBe(1);
    expect(parsed.deniedClaimCounts.external_version_claim).toBe(1);
  });

  // Arrives labelled `other`; this family posted two P0s against SHA-pinned actions while CI was green.
  it("relabels a version-existence claim before denying it", () => {
    expect(parsed.claimTypeCounts.external_version_claim).toBe(1);
    expect(
      parsed.comments.some((c) => c.title.includes("Invalid GitHub Action")),
    ).toBe(false);
  });

  it("gives the surviving finding both identities and an anchor", () => {
    const [comment] = parsed.comments;
    expect(comment.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(comment.fingerprintV2).toMatch(/^[0-9a-f]{8}$/);
    expect(comment.anchorHash).toMatch(/^[0-9a-f]{8}$/);
    // Anchored by the quote, not the model's reported line number.
    expect(comment.line).toBe(12);
  });
});

describe("a clean response", () => {
  it("produces no findings and approves", () => {
    const parsed = parseFileReviewResponse(
      '{"findings":[],"overall_explanation":"No issues.","overall_correctness":"patch is correct","overall_confidence_score":0.9}',
      file,
      { deniedClaimTypes: DEFAULT_DENIED_CLAIM_TYPES },
    );

    expect(parsed.comments).toEqual([]);
    expect(parsed.fileSummary).not.toContain("Off-diff");
    expect(parsed.verdict).toBe("approve");
    expect(parsed.evidenceStats.total).toBe(0);
  });
});
