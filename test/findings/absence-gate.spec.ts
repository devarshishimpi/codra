import { describe, expect, it } from "vitest";
import { parseFileReviewResponse } from "@codraoss/core/model-output";
import {
  buildPresenceIndex,
  checkAbsenceClaim,
} from "@codraoss/core/claim-checks";
import type { FileDiff } from "@codraoss/core/diff";

import { reviewJson } from "../mocks/fixtures";

// "X is missing", "the null check was removed", "this is never awaited" -- the one claim shape that is
// decidable by looking. The verdict was computed for a long time and then thrown away: the finding was
// posted anyway. These cover the gate having teeth, and the safety valves that keep it sound.

const file: FileDiff = {
  path: "src/handler.ts",
  previousPath: null,
  isNew: false,
  isDeleted: false,
  isBinary: false,
  lineCount: 4,
  hunks: [
    {
      header: "@@ -40,3 +40,4 @@",
      lines: [
        {
          kind: "context",
          content: "export async function handle(req) {",
          newLineNumber: 40,
          position: 1,
        },
        {
          kind: "add",
          content: "  const parsed = parseRequestBody(req);",
          newLineNumber: 41,
          position: 2,
        },
        {
          kind: "add",
          content: "  return respond(parsed);",
          newLineNumber: 42,
          position: 3,
        },
      ],
    },
  ],
};

const finding = (over: Record<string, unknown>) =>
  reviewJson(
    {
      evidence: "  return respond(parsed);",
      code_location: { absolute_file_path: file.path, line: 42 },
      ...over,
    },
    {
      title: "Unvalidated body",
      body: "The request body is used without checking.",
    },
  );

describe("refuted absence claims are withheld", () => {
  it("withholds a claim that an identifier present in the diff is missing", () => {
    const raw = finding({
      title: "Body is never parsed",
      body: "The handler uses the body directly; `parseRequestBody` is not called anywhere.",
    });

    const result = parseFileReviewResponse(raw, file);

    expect(result.comments).toHaveLength(0);
    expect(result.absenceCheckStats.refuted).toBe(1);
    // Surfaced to the reader, naming what refuted it, rather than vanishing.
    expect(result.fileSummary).toContain("parseRequestBody");
  });

  it("leaves a claim alone when the identifier really is absent", () => {
    const raw = finding({
      title: "No rate limiting",
      body: "This handler never calls `enforceRateLimit`, so it can be flooded.",
    });

    const result = parseFileReviewResponse(raw, file);

    expect(result.comments).toHaveLength(1);
    expect(result.absenceCheckStats.refuted).toBe(0);
  });

  // The matcher is a literal search over stripped source. It cannot tell a call from a definition, or
  // a live path from a dead one -- so at P0 the cost of being wrong runs the other way.
  it("never silences a P0, even when it can refute it", () => {
    const raw = finding({
      title: "Body is never parsed",
      body: "The handler uses the body directly; `parseRequestBody` is not called anywhere.",
      priority: 0,
    });

    const result = parseFileReviewResponse(raw, file);

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].severity).toBe("P0");
    // Still counted: the operator should see that the gate would have fired.
    expect(result.absenceCheckStats.refuted).toBe(1);
  });

  it("leaves findings that make no absence claim untouched", () => {
    const result = parseFileReviewResponse(
      finding({
        title: "Inconsistent response shape",
        body: "This returns a bare object while the rest of the module returns a Result.",
      }),
      file,
    );

    expect(result.comments).toHaveLength(1);
    expect(result.absenceCheckStats.absenceShaped).toBe(0);
  });
});

describe("the presence index over the post-image", () => {
  const index = (content?: string) => buildPresenceIndex(file, content);
  const claim = (identifier: string, anchorLine: number, content?: string) =>
    checkAbsenceClaim({
      title: "Missing guard",
      body: `\`${identifier}\` is never called before the value is used.`,
      anchorLine,
      index: index(content),
    });

  // The whole point: the guard that refutes the claim can sit outside the diff window, where neither
  // the reviewer nor a diff-only index can see it.
  it("refutes a claim using a line the diff never showed", () => {
    const postImage = [
      ...Array.from({ length: 34 }, (_, i) => `// line ${i + 1}`),
      "  assertAuthenticated(req);",
      ...Array.from({ length: 4 }, (_, i) => `// line ${i + 36}`),
      "export async function handle(req) {",
      "  const parsed = parseRequestBody(req);",
      "  return respond(parsed);",
    ].join("\n");

    expect(claim("assertAuthenticated", 42).status).toBe("unknown");
    expect(claim("assertAuthenticated", 42, postImage).status).toBe("refuted");
  });

  it("keeps the proximity window honest across both sources", () => {
    const far = [
      "  assertAuthenticated(req);",
      ...Array.from({ length: 200 }, (_, i) => `// line ${i + 2}`),
    ].join("\n");

    // Line 1 against an anchor at 42 is well outside the 25-line window.
    expect(claim("assertAuthenticated", 42, far)).toMatchObject({
      status: "unknown",
      reason: "out_of_window",
    });
  });

  it("reports where it found the identifier", () => {
    const postImage = [
      ...Array.from({ length: 39 }, (_, i) => `// line ${i + 1}`),
      "export async function handle(req) {",
      "  const parsed = parseRequestBody(req);",
      "  return respond(parsed);",
      "  logAudit(req);",
    ].join("\n");

    expect(claim("logAudit", 42, postImage)).toMatchObject({
      status: "refuted",
      line: 43,
    });
  });

  // A deleted line is not in the file after the change, so it can never refute "this is missing".
  it("ignores deleted lines", () => {
    const withDeletion: FileDiff = {
      ...file,
      hunks: [
        {
          header: "@@ -40,2 +40,1 @@",
          lines: [
            {
              kind: "del",
              content: "  assertAuthenticated(req);",
              oldLineNumber: 40,
              position: 1,
            },
            {
              kind: "add",
              content: "  return respond(req);",
              newLineNumber: 40,
              position: 2,
            },
          ],
        },
      ],
    };

    expect(
      checkAbsenceClaim({
        title: "Auth check removed",
        body: "The handler no longer calls `assertAuthenticated`.",
        anchorLine: 40,
        index: buildPresenceIndex(withDeletion),
      }),
    ).toMatchObject({ status: "unknown" });
  });

  it("does not double-count a line that is in both the diff and the post-image", () => {
    const postImage = [
      ...Array.from({ length: 39 }, (_, i) => `// line ${i + 1}`),
      "export async function handle(req) {",
      "  const parsed = parseRequestBody(req);",
      "  return respond(parsed);",
    ].join("\n");

    const built = buildPresenceIndex(file, postImage);
    const occurrences = built.byToken.get("parseRequestBody") ?? [];

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].hunkIndex).toBe(0);
  });
});
