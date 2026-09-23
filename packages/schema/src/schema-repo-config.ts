import { z } from 'zod';
import { reviewSeverities } from './review-limits';
import { reviewCategories } from './schema-enums';
import { claimTypes, DEFAULT_DENIED_CLAIM_TYPES, DEFAULT_SHADOW_RULE_IDS } from './schema-claims';
import {
  DEFAULT_REVIEW_EVENTS,
  DEFAULT_MENTION_TRIGGER,
  DEFAULT_SKIP_FILES,
  DEFAULT_EXEC_FILE_TYPES,
  DEFAULT_EXEC_COMMAND,
  DEFAULT_LABELS,
  DEPRECATED_MODEL_ALIASES,
} from './constants';

const labelsSchema = z.union([
  z.literal(false),
  z.object({
    p1: z.string().min(1),
    p2: z.string().min(1),
    p3: z.string().min(1),
  }),
]);

export const reviewConfigSchema = z.object({
  on: z.array(z.enum(['opened', 'synchronize', 'ready_for_review', 'reopened', 'closed'])).default([...DEFAULT_REVIEW_EVENTS]),
  ignore_drafts: z.boolean().default(true),
  mention_trigger: z.union([z.literal(false), z.string().min(1)]).default(DEFAULT_MENTION_TRIGGER),
  skip_files: z
    .array(z.string().min(1))
    .default([...DEFAULT_SKIP_FILES]),
  large_file_threshold_lines: z.number().int().min(1).max(5_000).default(200),
  max_diff_lines_per_file: z.number().int().min(1).max(5_000).default(800),
  batch_small_files: z.boolean().default(true),
  max_comments: z.number().int().min(1).max(150).default(10),
  review_breadth: z.number().int().min(1).max(150).default(25),
  full_file_context: z.boolean().default(false),
  min_severity: z.enum(reviewSeverities).default('P3'),
  language_gates: z
    .record(
      z.string(),
      z.object({
        min_severity: z.enum(reviewSeverities).optional(),
        min_confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .default({}),
  min_confidence: z.number().min(0).max(1).default(0),
  focus: z.array(z.enum(reviewCategories)).default([...reviewCategories]),
  deny_claim_types: z.array(z.enum(claimTypes)).default([...DEFAULT_DENIED_CLAIM_TYPES]),
  rules: z
    .object({
      enabled: z.boolean().default(true),
      disabled_rule_ids: z.array(z.string().min(1)).default([]),
      shadow_rule_ids: z.array(z.string().min(1)).default([...DEFAULT_SHADOW_RULE_IDS]),
    })
    .default({
      enabled: true,
      disabled_rule_ids: [],
      shadow_rule_ids: [...DEFAULT_SHADOW_RULE_IDS],
    }),
  custom_rules: z.array(z.string().min(1)).default([]),
  labels: labelsSchema.default({ ...DEFAULT_LABELS }),
  exec: z
    .object({
      enabled: z.boolean().default(false),
      on_file_types: z.array(z.string().min(1)).default([...DEFAULT_EXEC_FILE_TYPES]),
      command: z.string().min(1).default(DEFAULT_EXEC_COMMAND),
    })
    .default({
      enabled: false,
      on_file_types: [...DEFAULT_EXEC_FILE_TYPES],
      command: DEFAULT_EXEC_COMMAND,
    }),
});

export const DEFAULT_REVIEW_CONFIG = reviewConfigSchema.parse({});
export const DEFAULT_MODEL_CONFIG = { main: null, fallbacks: [], size_overrides: [], secondary: null };

export const repoConfigSchema = z.object({
  review: reviewConfigSchema.default(DEFAULT_REVIEW_CONFIG),
  model: z
    .object({
      main: z.string().nullable().default(null),
      fallbacks: z.array(z.string()).nullable().default([]),
      size_overrides: z
        .array(
          z.object({
            max_lines: z.number().int().positive(),
            model: z.string(),
            fallbacks: z.array(z.string()).optional(),
          }),
        )
        .nullable()
        .optional(),
      secondary: z
        .object({
          model: z.string(),
          fallbacks: z.array(z.string()).default([]),
        })
        .nullable()
        .optional(),
    })
    .default(DEFAULT_MODEL_CONFIG),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;

export function normalizeModelId(model: string) {
  return DEPRECATED_MODEL_ALIASES[model] ?? model;
}

export function normalizeRepoModelConfig(model: RepoConfig['model']): RepoConfig['model'] {
  return {
    ...model,
    main: model.main ? normalizeModelId(model.main) : null,
    fallbacks: model.fallbacks === null
      ? null
      : Array.isArray(model.fallbacks)
        ? model.fallbacks.map(normalizeModelId)
        : [],
    size_overrides: model.size_overrides === null || model.size_overrides === undefined
      ? model.size_overrides
      : model.size_overrides.map((tier) => ({
          ...tier,
          model: normalizeModelId(tier.model),
          fallbacks: tier.fallbacks?.map(normalizeModelId),
        })),
    ...(model.secondary
      ? {
          secondary: {
            model: normalizeModelId(model.secondary.model),
            fallbacks: (model.secondary.fallbacks ?? []).map(normalizeModelId),
          },
        }
      : {}),
  };
}

export function normalizeRepoConfig(config: RepoConfig): RepoConfig {
  return {
    ...config,
    model: normalizeRepoModelConfig(config.model),
  };
}

export const defaultRepoConfig = repoConfigSchema.parse({});
