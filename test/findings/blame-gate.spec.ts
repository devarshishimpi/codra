import { describe, expect, it } from "vitest";
import { parseFileReviewResponse } from "@codraoss/core/model-output";
import type { FileDiff } from "@codraoss/core/diff";

import { reviewJson } from "../mocks/fixtures";

// A review is of a CHANGE, not of a repository. A finding whose only evidence is an untouched context
// line is the reviewer commenting on code the author did not write -- the largest single category of
// documented-or-pre-existing false positives in the benchmark corpus.
//
// This is also what makes whole-file context safe: the prompt tells the model the context block is not
// evidence, and this gate is what enforces it.
const file: FileDiff = {
  path: "src/app.ts",
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: 6,
  hunks: [
    {
      header: "@@ -1,5 +1,6 @@",
      lines: [
        {
          kind: "context",
          content: "const config = loadConfiguration();",
          newLineNumber: 1,
          position: 1,
        },
        {
          kind: "context",
          content: "const legacyRetryCount = 3;",
          newLineNumber: 2,
          position: 2,
        },
        {
          kind: "del",
          content: "const timeout = 30000;",
          oldLineNumber: 3,
          position: 3,
        },
        {
          kind: "add",
          content: "const timeout = config.timeoutMs;",
          newLineNumber: 3,
          position: 4,
        },
        {
          kind: "add",
          content: "server.listen(timeout);",
          newLineNumber: 4,
          position: 5,
        },
      ],
    },
  ],
};

const review = (finding: Record<string, unknown>) =>
  reviewJson(finding, {
    title: "Unvalidated timeout",
    body: "The timeout value is never checked.",
  });

const parse = (evidence: string, line: number, target: FileDiff = file) =>
  parseFileReviewResponse(
    review({
      evidence,
      code_location: { absolute_file_path: target.path, line },
    }),
    target,
  );

describe("the blame gate", () => {
  it("keeps a finding quoting a line the change added", () => {
    const result = parse("const timeout = config.timeoutMs;", 3);

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].line).toBe(3);
    expect(result.evidenceStats.contextOnly).toBe(0);
  });

  // A finding about removed code is a finding about the change. The comment lands on the neighbouring
  // postable line, because GitHub cannot take a comment on a deleted one.
  it("keeps a finding quoting a line the change deleted", () => {
    const result = parse("const timeout = 30000;", 3);

    expect(result.comments).toHaveLength(1);
    expect(result.evidenceStats.contextOnly).toBe(0);
    expect(result.comments[0].line).toBe(3);
  });

  it("withholds a finding whose only evidence is an untouched line", () => {
    const result = parse("const legacyRetryCount = 3;", 2);

    expect(result.comments).toHaveLength(0);
    expect(result.evidenceStats.contextOnly).toBe(1);
    // Surfaced to the reader rather than vanishing, like every other withheld finding.
    expect(result.fileSummary).toContain("Unvalidated timeout");
  });

  // The same text can sit on both an untouched line and a changed one -- a moved line, a repeated
  // call. The finding could be about the changed occurrence, so it must survive.
  it("keeps a finding when the quoted text also appears on a changed line", () => {
    const moved: FileDiff = {
      ...file,
      hunks: [
        {
          header: "@@ -1,3 +1,3 @@",
          lines: [
            {
              kind: "context",
              content: "registerShutdownHandler(server);",
              newLineNumber: 1,
              position: 1,
            },
            {
              kind: "add",
              content: "registerShutdownHandler(server);",
              newLineNumber: 2,
              position: 2,
            },
          ],
        },
      ],
    };

    const result = parse("registerShutdownHandler(server);", 1, moved);

    expect(result.comments).toHaveLength(1);
    expect(result.evidenceStats.contextOnly).toBe(0);
    // Anchored to the added occurrence, not the untouched one, even though the model reported line 1.
    expect(result.comments[0].line).toBe(2);
  });

  // Substring containment resolves evidence the model paraphrased or truncated; it must be judged by
  // the same rule, or the gate is trivially bypassed by quoting half a line.
  it("withholds a partial quote of an untouched line", () => {
    const result = parse("const legacyRetryCount", 2);

    expect(result.comments).toHaveLength(0);
    expect(result.evidenceStats.contextOnly).toBe(1);
  });

  // Evidence that matches nothing was already withheld, and stays counted separately: "could not find
  // the quote at all" and "found it in the wrong place" are different reviewer failures.
  it("counts an unmatched quote apart from an untouched one", () => {
    const result = parse("const somethingThatIsNotInThisDiff = 1;", 3);

    expect(result.comments).toHaveLength(0);
    expect(result.evidenceStats.contextOnly).toBe(0);
    expect(result.evidenceStats.unmatched).toBe(1);
  });
});
