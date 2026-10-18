import { z } from "zod";

export const ModelSamplingConfigSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.7),
  topP: z.number().min(0).max(1).optional(),
  topK: z.number().int().min(1).optional(),
  thinkingBudget: z.union([z.literal("off"), z.literal("auto"), z.number().int().min(0)]).default("auto"),
  maxOutputTokens: z.number().int().positive().optional(),
});

export const ModelPromptConfigSchema = z.object({
  style: z.enum(["discovery", "calibrated", "concise", "reasoning_first"]).default("discovery"),
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
  sensitivity: z.enum(["strict", "balanced", "permissive"]).default("balanced"),
  downgradeUnverifiedToP3: z.boolean().default(true),
});

export const ModelProfileSchema = z.object({
  id: z.string(),
  provider: z.string(),
  displayName: z.string(),
  sampling: ModelSamplingConfigSchema,
  prompts: ModelPromptConfigSchema,
  schema: ModelSchemaConfigSchema,
  limits: ModelProfileLimitsSchema,
  verification: ModelProfileVerificationSchema,
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
export type ModelProfile = z.infer<typeof ModelProfileSchema>;
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;
