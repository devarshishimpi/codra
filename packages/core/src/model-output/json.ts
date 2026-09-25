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
  return /"(files|findings|overall_explanation|overall_correctness|overall_confidence_score|summary)"\s*:/.test(
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
  raw: string,
  anchorKey: "findings" | "files" = "findings",
) {
  const jsonBlocks = Array.from(raw.matchAll(/```json([\s\S]*?)```/gi));
  if (jsonBlocks.length > 0) {
    return jsonBlocks[jsonBlocks.length - 1][1].trim();
  }

  const genericBlocks = Array.from(
    raw.matchAll(/```(?:[\w+-]+)?([\s\S]*?)```/gi),
  );
  if (genericBlocks.length > 0) {
    const candidates = genericBlocks.filter(
      (b) => b[1].includes("{") && b[1].includes("}") && hasReviewKeys(b[1]),
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
    firstBrace = raw.lastIndexOf("{", targetIdx);
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

export function preprocessJson(json: string): string {
  let result = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (escape) {
      result += char;
      escape = false;
      continue;
    }

    if (char === "\\") {
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

export function normalizeFinding(finding: unknown) {
  if (!finding || typeof finding !== "object") return null;
  const f = finding as Record<string, unknown>;
  if (
    isPlaceholderString(f.title) ||
    isPlaceholderString(f.body) ||
    isPlaceholderString(f.evidence)
  )
    return null;

  const location =
    f.code_location && typeof f.code_location === "object"
      ? (f.code_location as Record<string, unknown>)
      : {};
  const line = coerceReviewNumber(location.line);
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
  const priority = coerceReviewNumber(f.priority);

  const codeLocation: Record<string, unknown> = {
    absolute_file_path: location.absolute_file_path || f.path || "",
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
    title:
      (f.title ? String(f.title) : "")
        .trim()
        .slice(0, 100)
        .replace(/[\uD800-\uDBFF]$/, "") || "Code finding",
    priority:
      priority === undefined
        ? undefined
        : Math.max(0, Math.min(4, Math.trunc(priority as number))),
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
  let extracted: string;
  try {
    extracted = extractJson(raw);
    if (!hasReviewKeys(extracted)) {
      throw new Error("Model response did not contain review JSON keys.");
    }
  } catch (e) {
    logger.error("Failed to extract JSON from model response", {
      rawLength: raw.length,
      rawPrefix: raw.slice(0, 500),
      error: e instanceof Error ? e.message : String(e),
    });
    throw new Error("Could not find JSON root in model response.", {
      cause: e,
    });
  }

  let preprocessed: string;
  try {
    preprocessed = preprocessJson(extracted);
  } catch (e) {
    logger.warn("JSON preprocessing partially failed, continuing...", {
      extracted,
      error: e,
    });
    preprocessed = extracted;
  }

  let repaired = preprocessed;
  try {
    repaired = jsonrepair(preprocessed);
  } catch (e) {
    logger.warn(
      "jsonrepair failed to fix model output, using preprocessed text",
      { preprocessed: truncateJsonForLog(preprocessed), error: e },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = stripNulls(JSON.parse(repaired));
  } catch (e) {
    logger.error("Critical JSON parse error after extraction and repair", {
      repaired: truncateJsonForLog(repaired),
      error: e,
    });
    throw new Error(
      `Invalid JSON format: ${e instanceof Error ? e.message : "Unknown error"}`,
      { cause: e },
    );
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
      if (!obj.findings) obj.findings = [];
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
