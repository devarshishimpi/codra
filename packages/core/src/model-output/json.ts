import { fileReviewModelOutputSchema } from "@codraoss/schema";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { logger } from "../logger";
import {
  extractJson,
  extractMarkdownFindings,
  hasReviewKeys,
  preprocessJson,
} from "./json-extract";

export * from "./json-extract";

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
  } catch { /* ignore */ }

  let parsedJson: unknown = null;
  if (jsonExtracted) {
    let preprocessed: string;
    try {
      preprocessed = preprocessJson(extracted);
    } catch {
      preprocessed = extracted;
    }

    let repaired = preprocessed;
    try {
      repaired = jsonrepair(preprocessed);
    } catch { /* ignore */ }

    try {
      parsedJson = stripNulls(JSON.parse(repaired));
    } catch { /* ignore */ }
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
