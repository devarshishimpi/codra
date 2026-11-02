import type { FileDiff, DiffLine } from "@codraoss/core/diff";

// Shared fixture builders, deduped from parser/rule/webhook suites.

// defaults/finding must merge inside the finding object, not over the envelope, or title is lost.
export function reviewJson(
  finding: Record<string, unknown>,
  defaults: Record<string, unknown> = {},
) {
  return JSON.stringify({
    findings: [
      {
        title: "Unvalidated input",
        body: "The value is never checked.",
        priority: 1,
        confidence_score: 0.9,
        ...defaults,
        ...finding,
      },
    ],
    overall_correctness: "patch is incorrect",
    overall_explanation: "explanation",
    overall_confidence_score: 0.8,
  });
}

export function addedLinesFile(
  path: string,
  added: string[],
  removed: string[] = [],
): FileDiff {
  let n = 0;
  return {
    path,
    previousPath: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount: added.length + removed.length,
    hunks: [
      {
        header: "@@ -1,10 +1,10 @@",
        lines: [
          ...removed.map((content) => ({
            kind: "del" as const,
            content,
            oldLineNumber: ++n,
            position: n,
          })),
          ...added.map((content) => ({
            kind: "add" as const,
            content,
            newLineNumber: ++n,
            position: n,
          })),
        ],
      },
    ],
  };
}

// for suites needing interleaved del/context kinds
export function fileFromLines(
  lines: Array<Partial<DiffLine> & { content: string }>,
  path = "src/stats.ts",
): FileDiff {
  let n = 0;
  return {
    path,
    previousPath: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount: lines.length,
    hunks: [
      {
        header: "@@ -1,10 +1,10 @@",
        lines: lines.map((line) => {
          n += 1;
          return {
            kind: "add" as const,
            newLineNumber: n,
            position: n,
            ...line,
          };
        }),
      },
    ],
  };
}

// GitHub webhook signature format: sha256=<hex>
export async function signPayload(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const hex = Array.from(new Uint8Array(signature), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256=${hex}`;
}
