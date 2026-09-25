import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import type { FileDiff } from "../diff";

export type VerifyCandidate = {
  index: number;
  path: string;
  line: number | null;
  title: string;
  body: string;
  snippet: string;
  evidence?: string | null;
};

const verifyResultSchema = z.object({
  results: z
    .array(
      z.object({
        index: z.number().int(),
        reason: z.string().optional(),
        // decidable" -- only an explicit `false` costs a finding. See the note on the prompt below.
        decidable: z.boolean().optional(),
        verdict: z.enum(["keep", "drop"]),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .default([]),
});

export type VerifyResult = z.infer<
  typeof verifyResultSchema
>["results"][number];

export const VERIFY_RESPONSE_SCHEMA = {
  name: "codra_verify_findings",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["results"],
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "reason", "decidable", "verdict"],
          properties: {
            index: { type: "integer", minimum: 0 },
            reason: { type: "string", maxLength: 300 },
            decidable: { type: "boolean" },
            verdict: { type: "string", enum: ["keep", "drop"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
    },
  },
} as const;

export const VERIFY_SYSTEM_PROMPT = `You are a meticulous senior engineer checking whether each candidate code-review finding is actually supported by the code it points at.

For EACH finding you are given the claim and a SHORT WINDOW of diff context around the line it was anchored to. That window is all you have: you cannot see the rest of the file, any other file, the project's dependencies and their versions, its build target, or its runtime.

Answer two questions per finding, in this order.

1. "decidable": can this claim be settled from the window you were given?
   - true  - the window contains everything needed to say whether the claim holds.
   - false - settling it would need something outside the window: which files import this one, what a function defined elsewhere does, which version of a dependency is installed, what engine or renderer the code runs on, or how a caller uses the result.
   Watch for claims that assert a CONSEQUENCE somewhere you cannot see: "this breaks importers", "this throws on older runtimes", "this fails during server rendering", "the caller will not await this". The anchored line can be exactly as quoted and the consequence still be unverifiable - confirming that the quote is real is NOT confirming the claim.
   When "decidable" is false, say in "reason" what you would have to look at, e.g. "would need the importers of this module".

   Two rules, because both have been got wrong on real reviews:

   a) A claim of the form "if X() fails / rejects / throws, this is unhandled" is NOT decidable unless the
      BODY of X is inside your window. A function whose body you cannot see may well handle its own
      errors, in which case there is nothing to report. Seeing the CALL is not seeing the body. Mark it
      not decidable and say you would need that function's implementation.

   b) Read the diff markers before you agree that something was removed or changed. A line prefixed "-"
      is the OLD code and a line prefixed "+" is the NEW code. A claim that says "X was replaced by Y" is
      false if the diff shows Y being replaced by X, and a claim that a safeguard was "removed" is false
      if the "+" line still carries an equivalent one under a different name. State the direction in your
      reason: "the + line adds strict validation, so the claim is backwards".

2. "verdict":
   - "keep": the code in the window genuinely exhibits the problem the claim describes.
   - "drop": the claim is not supported by the code shown - it describes something that isn't there, it is speculative, it is a subjective style preference, or it is not decidable from this window.
   A claim you marked not decidable is always a "drop".

Judge the CLAIM against the CODE. Do not defer to the claim's confidence or phrasing; a well-written claim about code that doesn't do what it says is still a drop.
Be strict: when in doubt, "drop". It is better to drop a borderline finding than to keep a wrong one.

Output MUST be valid JSON, exactly one object, no prose before or after:
{
  "results": [
    { "index": <number>, "reason": "<why, and if not decidable what you would need to see>", "decidable": true | false, "verdict": "keep" | "drop", "confidence": <float 0.0-1.0> }
  ]
}
Include exactly one result object for every finding index provided, and use the same index numbers you were given.`;

export function buildVerifyPrompt(candidates: VerifyCandidate[]): string {
  const blocks = candidates.map((c) => {
    const location = c.line != null ? `${c.path}:${c.line}` : c.path;
    return [
      `### Finding index ${c.index}`,
      `Location: ${location}`,
      `Title: ${c.title}`,
      `Claim: ${c.body}`,
      ...(c.evidence ? [`Code the claim cites: ${c.evidence}`] : []),
      "Relevant diff:",
      c.snippet || "(no diff context available for this location)",
    ].join("\n");
  });

  return [
    "Validate each finding below against its diff context. Return a verdict for every index.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

export function renderDiffSnippet(
  file: FileDiff | undefined,
  line: number | undefined,
  radius = 12,
): string {
  if (!file) return "";
  const flat = file.hunks.flatMap((hunk) => hunk.lines);
  if (flat.length === 0) return "";

  if (line == null) return "";

  const byNewLine = flat.findIndex((l) => l.newLineNumber === line);
  const anchor =
    byNewLine !== -1
      ? byNewLine
      : flat.findIndex((l) => l.oldLineNumber === line);
  if (anchor === -1) return "";

  const start = Math.max(0, anchor - radius);
  const end = Math.min(flat.length, anchor + radius + 1);

  return flat
    .slice(start, end)
    .map((l) => {
      const prefix = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ";
      const gutter = String(l.newLineNumber ?? l.oldLineNumber ?? "").padStart(
        4,
        " ",
      );
      return `${gutter} ${prefix}${l.content}`;
    })
    .join("\n");
}

export function parseVerifyResponse(raw: string): VerifyResult[] {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate =
    start !== -1 && end !== -1 && end > start
      ? trimmed.slice(start, end + 1)
      : trimmed;

  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    json = JSON.parse(jsonrepair(candidate));
  }

  return verifyResultSchema.parse(json).results;
}
