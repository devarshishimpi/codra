import { claimTypes } from "@codraoss/schema";
import type { ModelResponseSchema } from "../ports/model";

export function findingItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "evidence",
      "code_location",
      "claim_type",
      "title",
      "body",
      "priority",
    ],
    properties: {
      evidence: { type: "string" },
      code_location: {
        type: "object",
        additionalProperties: false,
        properties: {
          absolute_file_path: { type: "string" },
          line: { type: "integer", minimum: 1 },
          line_range: {
            type: "object",
            additionalProperties: false,
            required: ["start", "end"],
            properties: {
              start: { type: "integer", minimum: 1 },
              end: { type: "integer", minimum: 1 },
            },
          },
        },
        anyOf: [{ required: ["line"] }, { required: ["line_range"] }],
      },
      claim_type: { type: "string", enum: [...claimTypes] },
      title: { type: "string", maxLength: 100 },
      body: { type: "string" },
      priority: { type: "integer", minimum: 0, maximum: 4 },
      code_suggestion: { type: "string" },
    },
  };
}

export function flatFindingItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "path",
      "line",
      "severity",
      "title",
      "body",
      "evidence",
    ],
    properties: {
      path: { type: "string" },
      line: { type: "integer", minimum: 1 },
      severity: { type: "integer", minimum: 0, maximum: 4 },
      claim_type: { type: "string" },
      title: { type: "string", maxLength: 100 },
      body: { type: "string" },
      evidence: { type: "string" },
    },
  };
}

export function buildReviewResponseSchema(
  findingCap: number,
  format?: string,
): ModelResponseSchema {
  return {
    name: "codra_file_review",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["findings"],
      properties: {
        findings: {
          type: "array",
          maxItems: Math.max(1, findingCap),
          items: format === "flat_json_schema" ? flatFindingItemSchema() : findingItemSchema(),
        },
      },
    },
  };
}

export function buildBatchReviewResponseSchema(
  findingCap: number,
  fileCount?: number,
  format?: string,
): ModelResponseSchema {
  if (format === "flat_json_schema") {
    return {
      name: "codra_batch_review",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["findings"],
        properties: {
          findings: {
            type: "array",
            maxItems: Math.max(1, findingCap),
            items: flatFindingItemSchema(),
          },
        },
      },
    };
  }

  return {
    name: "codra_batch_review",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["files", "overall_confidence_score"],
      properties: {
        files: {
          type: "array",
          ...(fileCount !== undefined ? { maxItems: fileCount } : {}),
          items: {
            type: "object",
            additionalProperties: false,
            // Path first, like `evidence` in a finding: commit to the file before describing it.
            required: [
              "absolute_file_path",
              "findings",
              "overall_explanation",
              "overall_correctness",
            ],
            properties: {
              absolute_file_path: { type: "string" },
              // Deliberately unbounded, unlike the single-file grammar: `maxItems` on an array nested inside an array triggers Gemini grammar limits.
              findings: {
                type: "array",
                items: findingItemSchema(),
              },
              overall_explanation: { type: "string" },
              overall_correctness: {
                type: "string",
                enum: ["patch is correct", "patch is incorrect"],
              },
            },
          },
        },
        overall_confidence_score: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  };
}
