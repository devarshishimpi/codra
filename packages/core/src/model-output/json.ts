import { fileReviewModelOutputSchema } from "@codraoss/schema";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { logger } from "../logger";

import { MAX_LOGGED_JSON_CHARS } from "../constants";

export function truncateJsonForLog(value: string) {
  if (value.length <= MAX_LOGGED_JSON_CHARS) return value;
  return `${value.slice(0, MAX_LOGGED_JSON_CHARS)}... [truncated ${value.length - MAX_LOGGED_JSON_CHARS} chars]`;
}

export function hasReviewKeys(input: string) {
  return /"(files|findings|issues|comments|reviews|overall_explanation|overall_correctness|overall_confidence_score|summary|title|body|evidence|code_location|claim_type|defect|analysis|notes?|format|id|content|line)"\s*:/.test(
    input,
  );
}

function scanBalanced(
  raw: string,
  startIdx: number,
  open: string,
  close: string,
): string | null {
  let stack = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < raw.length; i++) {
    const char = raw[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === open) stack++;
    else if (char === close) {
      stack--;
      if (stack === 0) return raw.slice(startIdx, i + 1);
    }
  }

  return null;
}

export function extractJson(
  input: string,
  anchorKey: "findings" | "files" = "findings",
) {
  // Repair unescaped quotes first: the brace scan below tracks strings by their quotes, and one stray quote
  // (a model quoting `\\"` from escaping code) made it cut the object at the wrong brace. Idempotent, so the
  // second pass in preprocessJson changes nothing.
  const raw = dropStrayKeyFragments(sanitizeInnerQuotes(input));
  const jsonBlocks = Array.from(raw.matchAll(/```json\s*([\s\S]*?)(?:```|$)/gi));
  if (jsonBlocks.length > 0) {
    const candidates = jsonBlocks.slice().reverse().find(b => b[1].includes('"findings"') || b[1].includes('"files"') || b[1].includes('"path"'));
    return (candidates ? candidates[1] : jsonBlocks[jsonBlocks.length - 1][1]).trim();
  }

  const genericBlocks = Array.from(
    raw.matchAll(/```(?:[\w+-]+)?\s*([\s\S]*?)(?:```|$)/gi),
  );
  if (genericBlocks.length > 0) {
    const candidates = genericBlocks.filter(
      (b) => b[1].includes("{") && (b[1].includes("}") || b[1].includes('"findings"')) && (hasReviewKeys(b[1]) || b[1].includes('"path"')),
    );
    if (candidates.length > 0) {
      const content = candidates[candidates.length - 1][1].trim();
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        return content.slice(start, end + 1);
      }
      return content;
    }
  }

  const arrayStart = raw.indexOf("[");
  if (arrayStart !== -1 && raw.slice(0, arrayStart).trim() === "") {
    const matched = scanBalanced(raw, arrayStart, "[", "]");
    if (matched && hasReviewKeys(matched)) return matched;
  }

  const anchorIdx = anchorKey === "files" ? raw.indexOf('"files"') : -1;
  const findingsIdx = anchorIdx !== -1 ? anchorIdx : raw.indexOf('"findings"');
  const summaryIdx = raw.indexOf('"summary"');
  const targetIdx =
    findingsIdx !== -1 ? findingsIdx : summaryIdx !== -1 ? summaryIdx : -1;

  let firstBrace = -1;
  if (targetIdx !== -1) {
    const allBraces = Array.from(raw.matchAll(/\{/g)).map(m => m.index!).filter(i => i <= targetIdx);
    for (const idx of allBraces) {
      const balanced = scanBalanced(raw, idx, "{", "}");
      if (!balanced || (idx + balanced.length) > targetIdx) {
        firstBrace = idx;
        break;
      }
    }
    if (firstBrace === -1) {
      firstBrace = raw.lastIndexOf("{", targetIdx);
    }
  }

  if (firstBrace === -1) {
    const allBraces = Array.from(raw.matchAll(/\{/g));
    let bestIdx = -1;
    let bestScore = -1;

    for (const match of allBraces) {
      const idx = match.index!;
      const excerpt = raw.slice(idx, idx + 200);
      let score = 0;

      if (excerpt.includes('"files"')) score += 100;
      if (excerpt.includes('"findings"')) score += 100;
      if (excerpt.includes('"summary"')) score += 50;
      if (excerpt.includes('"overall_explanation"')) score += 50;

      if (excerpt.includes('" : ') || excerpt.includes('":')) score += 10;
      if (excerpt.includes('"[')) score += 5;

      if (excerpt.includes(": number;") || excerpt.includes(": string;"))
        score -= 80;
      if (excerpt.includes("export ") || excerpt.includes("function "))
        score -= 80;
      if (excerpt.includes("interface ") || excerpt.includes("type "))
        score -= 80;
      if (excerpt.includes(" + ")) score -= 20; // Looks like a diff hunk

      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }

    if (bestIdx !== -1 && bestScore > 0) {
      firstBrace = bestIdx;
    }
  }

  if (firstBrace === -1) {
    const start = raw.indexOf("{");
    if (start !== -1) {
      const excerpt = raw.slice(start, start + 50);
      if (excerpt.includes('"') && excerpt.includes(":")) {
        firstBrace = start;
      }
    }
  }

  if (firstBrace !== -1) {
    let stack = 0;
    let inString = false;
    let escape = false;

    for (let i = firstBrace; i < raw.length; i++) {
      const char = raw[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === "\\") {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === "{") stack++;
        else if (char === "}") {
          stack--;
          if (stack === 0) {
            return raw.slice(firstBrace, i + 1);
          }
        }
      }
    }

    const partial = raw.slice(firstBrace).trim();
    let closing = "";
    if (inString) closing += '"';
    closing += "}".repeat(Math.max(1, stack));
    return `${partial}${closing}`;
  }

  return raw.trim();
}

/**
 * Removes a broken key fragment opening the reply: step-5-preview sometimes answers `{"  ,"findings": [...]}`,
 * which no parser accepts, and the whole reply was discarded. Only the reply's first brace is touched
 * (optionally inside a ```json fence): further in, the same characters occur inside string values, such
 * as evidence `"  if (asChild) {",` followed by the next key.
 */
export function dropStrayKeyFragments(str: string): string {
  return str.replace(/^(\s*(?:```(?:json)?\s*)?)\{\s*"\s*,\s*"(?=[A-Za-z_])/i, '$1{"');
}

export function sanitizeInnerQuotes(str: string): string {
  return str.replace(
    /^(\s*"(?:evidence|body|title|summary|description|message|comment|detail|quote|code_suggestion|fix|replacement|patch|example)"\s*:\s*")(.*)("(?:\s*,?\s*(?:}|\])?\s*\r?))$/gm,
    (m, p1, p2, p3) => p1 + escapeInnerQuotes(p2) + p3,
  );
}

/**
 * Escapes the quotes inside one string value that a model left unescaped. A quote is already escaped only
 * when an ODD number of backslashes precedes it: models quoting escaping code (`replace("\\", "\\\\")`)
 * write `\\"`, an escaped backslash followed by a bare quote, which ended the string early and lost the
 * whole reply. A value ending in an odd run of backslashes would escape its own closing quote, so the
 * last backslash is doubled into a literal one.
 */
function escapeInnerQuotes(value: string): string {
  let out = "";
  let run = 0;
  for (const char of value) {
    if (char === '"' && run % 2 === 0) out += "\\";
    out += char;
    run = char === "\\" ? run + 1 : 0;
  }
  return run % 2 === 1 ? `${out}\\` : out;
}

export function extractMarkdownFindings(raw: string): any[] {
  const mdFindings: any[] = [];
  const sections = raw.split(/(?:###|\*\*)\s*(?:Finding|Defect|Issue|Bug)\s*\d*[:\.]?/i);
  if (sections.length > 1) {
    for (const sec of sections.slice(1)) {
      const path = /(?:File|Path|Location):\s*[`"']?([^\s`"'\n]+)/i.exec(sec)?.[1];
      const lineStr = /(?:Line|Line number):\s*(\d+)/i.exec(sec)?.[1];
      const sev = /(?:Severity|Priority):\s*(P[0-3]|0|1|2|3)/i.exec(sec)?.[1] ?? 'P2';
      const title = /(?:Title|Description|Summary):\s*([^\n]+)/i.exec(sec)?.[1] ?? sec.trim().split('\n')[0].replace(/^#*\s*/, '').slice(0, 100);
      const evidence = /(?:Evidence|Code|Quoted line):\s*[`"']?([^\n`"']+)/i.exec(sec)?.[1];
      if (path) {
        mdFindings.push({
          path,
          line: lineStr ? parseInt(lineStr, 10) : undefined,
          code_location: {
            absolute_file_path: path,
            line: lineStr ? parseInt(lineStr, 10) : undefined,
          },
          severity: sev.startsWith('P') ? sev : `P${sev}`,
          title: title.trim(),
          body: sec.trim().slice(0, 500),
          evidence: evidence ? evidence.trim() : undefined,
        });
      }
    }
  }
  return mdFindings;
}

export function preprocessJson(json: string): string {
  const sanitized = sanitizeInnerQuotes(json);
  let result = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < sanitized.length; i++) {
    const char = sanitized[i];

    if (escape) {
      result += char;
      escape = false;
      continue;
    }

    if (char === "\\") {
      // `\u` must be followed by four hex digits or JSON.parse (and jsonrepair) reject the whole reply;
      // a model writing about `\u12` or `\user` means a literal backslash.
      if (inString && sanitized[i + 1] === "u" && !/^[0-9a-fA-F]{4}$/.test(sanitized.slice(i + 2, i + 6))) {
        result += "\\\\";
        continue;
      }
      result += char;
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      if (char === "\n") {
        result += "\\n";
      } else if (char === "\r") {
        result += "\\r";
      } else {
        result += char;
      }
    } else {
      result += char;
    }
  }

  return result;
}

/**
 * Deletes every `null`-valued key, recursively, before Zod sees the payload.
 *
 * The model output schemas mark optional fields `.optional()`, which accepts an ABSENT key and rejects
 * an explicit `null` -- and these models routinely emit `"code_suggestion": null` for a finding that
 * carries no suggestion. On the batched path that single null failed
 * `batchReviewModelOutputSchema.parse`, so `parseBatchReviewResponse` threw and the response for EVERY
 * file in the bin was discarded, then reported as an unreadable answer and failed over to the next
 * model. Measured on this repository's own review: 37 of 88 rejected payloads were otherwise complete
 * and readable.
 *
 * Stripping rather than widening each field is deliberate: absent and null mean the same thing to every
 * one of these schemas, one pass covers the fields nobody has thought of yet, and no downstream type
 * has to learn about `null`.
 */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripNulls) as unknown as T;
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null) continue;
    out[key] = stripNulls(entry);
  }
  return out as T;
}

function isPlaceholderString(value: unknown) {
  return typeof value === "string" && /^<[^>]+>$/.test(value.trim());
}

function coerceReviewNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !isPlaceholderString(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function coercePriority(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(4, Math.trunc(value)));
  }
  if (typeof value === "string" && !isPlaceholderString(value)) {
    const match = /^P?([0-4])$/i.exec(value.trim());
    if (match) return Number(match[1]);
    const num = Number(value.trim());
    if (Number.isFinite(num)) {
      return Math.max(0, Math.min(4, Math.trunc(num)));
    }
  }
  return undefined;
}

export function normalizeFinding(finding: unknown) {
  if (!finding || typeof finding !== "object") return null;
  const f = finding as Record<string, unknown>;
  const resolvedBody = String(
    f.body ?? f.description ?? f.explanation ?? f.message ?? f.comment ?? "",
  ).trim();

  if (
    isPlaceholderString(f.title) ||
    isPlaceholderString(resolvedBody) ||
    isPlaceholderString(f.evidence)
  )
    return null;

  const location =
    f.code_location && typeof f.code_location === "object"
      ? (f.code_location as Record<string, unknown>)
      : {};
  const line = coerceReviewNumber(location.line) ?? coerceReviewNumber(f.line);
  const start = coerceReviewNumber(
    location.line_range && typeof location.line_range === "object"
      ? (location.line_range as Record<string, unknown>).start
      : undefined,
  );
  const end = coerceReviewNumber(
    location.line_range && typeof location.line_range === "object"
      ? (location.line_range as Record<string, unknown>).end
      : undefined,
  );
  const priority = coercePriority(f.priority) ?? coercePriority(f.severity);

  const rawPath = String(location.absolute_file_path || f.path || f.file_path || f.filename || "").trim();
  const codeLocation: Record<string, unknown> = {
    absolute_file_path: rawPath,
  };
  if (line !== undefined) {
    codeLocation.line = Math.trunc(line as number);
  }
  if (start !== undefined || end !== undefined) {
    codeLocation.line_range = {
      start: Math.trunc((start as number) ?? (end as number)!),
      end: Math.trunc((end as number) ?? (start as number)!),
    };
  }

  return {
    ...f,
    path: rawPath,
    line: line !== undefined ? Math.trunc(line as number) : undefined,
    severity: priority !== undefined ? `P${priority}` : (typeof f.severity === "string" ? f.severity : undefined),
    title:
      (f.title ? String(f.title) : "")
        .trim()
        .slice(0, 100)
        .replace(/[\uD800-\uDBFF]$/, "") || "Code finding",
    body: resolvedBody || "No description provided.",
    evidence:
      typeof f.evidence === "string" && f.evidence.trim()
        ? f.evidence.trim()
        : typeof f.quote === "string" && f.quote.trim()
          ? f.quote.trim()
          : undefined,
    priority: priority !== undefined ? priority : undefined,
    code_location: codeLocation,
    confidence_score:
      typeof f.confidence_score === "number"
        ? Math.max(
            0,
            Math.min(
              1,
              f.confidence_score > 1
                ? f.confidence_score / 10
                : f.confidence_score,
            ),
          )
        : undefined,
  };
}

export function parseRawPayload(
  raw: string,
): z.infer<typeof fileReviewModelOutputSchema> {
  let extracted: string = "";
  let jsonExtracted = false;
  try {
    extracted = extractJson(raw);
    if (hasReviewKeys(extracted) || /^\s*\{[\s\S]*\}\s*$/.test(extracted)) {
      jsonExtracted = true;
    }
  } catch {}

  let parsedJson: unknown = null;
  if (jsonExtracted) {
    let preprocessed: string = extracted;
    try {
      preprocessed = preprocessJson(extracted);
    } catch {
      preprocessed = extracted;
    }

    let repaired = preprocessed;
    try {
      repaired = jsonrepair(preprocessed);
    } catch {}

    try {
      parsedJson = stripNulls(JSON.parse(repaired));
    } catch {}
  }

  if (!parsedJson) {
    const mdFindings = extractMarkdownFindings(raw);
    if (mdFindings.length > 0) {
      parsedJson = {
        findings: mdFindings,
        overall_explanation: "Extracted from markdown findings.",
        overall_correctness: "Uncertain",
        overall_confidence_score: 0.5,
      };
    } else {
      logger.error("Failed to extract JSON or markdown findings from model response", {
        rawLength: raw.length,
        rawPrefix: raw.slice(0, 500),
      });
      throw new Error("Could not find JSON root or findings in model response.");
    }
  }

  try {
    const findReviewObject = (arr: unknown[]): unknown | null => {
      const best = arr.find(
        (i) =>
          i &&
          typeof i === "object" &&
          Array.isArray((i as Record<string, unknown>).findings) &&
          typeof (i as Record<string, unknown>).summary === "string",
      );
      if (best) return best;

      const good = arr.find(
        (i) =>
          i &&
          typeof i === "object" &&
          Array.isArray((i as Record<string, unknown>).findings),
      );
      if (good) return good;

      return arr.find(
        (i) =>
          i &&
          typeof i === "object" &&
          ("findings" in i ||
            "overall_explanation" in i ||
            "summary" in i ||
            "overall_correctness" in i),
      );
    };

    let data = Array.isArray(parsedJson)
      ? findReviewObject(parsedJson) || parsedJson[0] || {}
      : parsedJson;

    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      if (!obj.findings) {
        if (Array.isArray(obj.issues)) {
          obj.findings = obj.issues;
        } else if (Array.isArray(obj.comments)) {
          obj.findings = obj.comments;
        } else if (Array.isArray(obj.reviews)) {
          obj.findings = obj.reviews;
        } else if (obj.defect && !obj.body) {
          obj.body = String(obj.defect);
          if (!obj.title) obj.title = String(obj.defect).slice(0, 100);
        }
        if (obj.findings) {
          // already assigned above
        } else if (obj.title || obj.body || obj.code_location || obj.evidence || obj.defect) {
          obj.findings = [{ ...obj }];
        } else {
          obj.findings = [];
        }
      }
      if (!obj.overall_explanation)
        obj.overall_explanation = "No explanation provided.";
      if (!obj.overall_correctness) obj.overall_correctness = "Uncertain";

      if (typeof obj.overall_confidence_score === "number") {
        if (obj.overall_confidence_score > 1) {
          obj.overall_confidence_score = Math.min(
            obj.overall_confidence_score / 10,
            1,
          );
        } else if (obj.overall_confidence_score < 0) {
          obj.overall_confidence_score = 0;
        }
      } else {
        obj.overall_confidence_score = 0.5;
      }

      if (Array.isArray(obj.findings)) {
        obj.findings = obj.findings.flatMap((finding: unknown) => {
          const normalized = normalizeFinding(finding);
          return normalized ? [normalized] : [];
        });
      }
      data = obj;
    }

    return fileReviewModelOutputSchema.parse(data);
  } catch (e) {
    logger.error("Model response failed schema validation", {
      parsedJson,
      error: e,
    });
    throw new Error(
      `Response schema mismatch: ${e instanceof Error ? e.message : "Check logs"}`,
      { cause: e },
    );
  }
}
