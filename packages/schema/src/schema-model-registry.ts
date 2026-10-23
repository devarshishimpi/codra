import { z } from "zod";
import { claimTypes } from "./schema-claims";

export const ModelSamplingConfigSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.7),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().int().min(1).optional(),
  thinkingBudget: z.union([z.literal("off"), z.literal("auto"), z.number().int().min(0)]).default("auto"),
  maxOutputTokens: z.number().int().positive().optional(),
});

// Every style a profile may name. calibrated, balanced and trace_then_report are the per-model prompt
// transforms in @codraoss/core/prompts/model-styles; the rest are carried as plain labels.
export const modelPromptStyles = [
  "discovery",
  "calibrated",
  "concise",
  "reasoning_first",
  "balanced",
  "trace_then_report",
] as const;
export type ModelPromptStyle = (typeof modelPromptStyles)[number];

export const ModelPromptConfigSchema = z.object({
  style: z.enum(modelPromptStyles).default("discovery"),
  systemPromptAdditions: z.array(z.string()).default([]),
  instructionFocus: z.array(z.string()).default([]),
});

export const ModelSchemaConfigSchema = z.object({
  format: z.enum(["strict_json_schema", "flat_json_schema", "json_object_mode"]).default("strict_json_schema"),
  flattenCodeLocation: z.boolean().default(false),
});

export const ModelProfileLimitsSchema = z.object({
  maxConcurrentCalls: z.number().int().min(1).default(3),
  rpmLimit: z.number().int().min(1).default(15),
  dailyRequestLimit: z.number().int().positive().optional(),
});

export const ModelProfileVerificationSchema = z.object({
  // false skips the verifier pass for this model (its self-verification discarded real defects).
  enabled: z.boolean().default(true).optional(),
  sensitivity: z.enum(["strict", "balanced", "permissive"]).default("balanced"),
  downgradeUnverifiedToP3: z.boolean().default(false),
  dropUndecidable: z.boolean().default(true),
  strictDiffOnly: z.boolean().default(true),
});

export const ModelProfileGatesSchema = z.object({
  maxComments: z.number().int().min(1).max(50).default(5),
  minSeverity: z.enum(["P0", "P1", "P2", "P3", "nit"]).default("P2"),
  minConfidence: z.number().min(0).max(1).default(0.65),
  suppressTestFiles: z.boolean().default(true),
});

export const ModelProfileTopologySchema = z.object({
  mode: z.enum(["unified", "chunked"]).default("unified"),
  maxDiffLinesPerFile: z.number().int().min(50).default(1000),
  maxDiffChars: z.number().int().min(10000).default(300000),
  thoughtBudgetWords: z.number().int().optional(),
  jsonFirst: z.boolean().default(false),
  verifierFullContext: z.boolean().default(true),
});

export type ModelProfileTopology = z.infer<typeof ModelProfileTopologySchema>;

export const ModelProfileSchema = z.object({
  id: z.string(),
  provider: z.string(),
  displayName: z.string(),
  sampling: ModelSamplingConfigSchema,
  prompts: ModelPromptConfigSchema,
  schema: ModelSchemaConfigSchema,
  limits: ModelProfileLimitsSchema,
  verification: ModelProfileVerificationSchema,
  gates: ModelProfileGatesSchema.optional(),
  topology: ModelProfileTopologySchema.optional(),
});

export const ModelRegistrySchema = z.object({
  version: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.literal("1.0.0"),
  profiles: z.record(z.string(), ModelProfileSchema),
});

export type ModelSamplingConfig = z.infer<typeof ModelSamplingConfigSchema>;
export type ModelPromptConfig = z.infer<typeof ModelPromptConfigSchema>;
export type ModelSchemaConfig = z.infer<typeof ModelSchemaConfigSchema>;
export type ModelProfileLimits = z.infer<typeof ModelProfileLimitsSchema>;
export type ModelProfileVerification = z.infer<typeof ModelProfileVerificationSchema>;
export type ModelProfileGates = z.infer<typeof ModelProfileGatesSchema>;
export type ModelProfile = z.infer<typeof ModelProfileSchema>;
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;
