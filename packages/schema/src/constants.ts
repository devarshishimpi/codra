export const DEFAULT_REVIEW_EVENTS = [
  "opened",
  "synchronize",
  "ready_for_review",
  "reopened",
] as const;
export const DEFAULT_SKIP_FILES = [
  "**/*.lock",
  "dist/**",
  "build/**",
  ".next/**",
  "*.generated.*",
  "coverage/**",
];
export const DEFAULT_EXEC_FILE_TYPES = [".ts", ".tsx", ".js"];
export const DEFAULT_EXEC_COMMAND = "npm run lint && npm run typecheck";
export const DEFAULT_MENTION_TRIGGER = "@codra-app";
export const DEFAULT_LABELS = {
  p1: "review: needs-attention",
  p2: "review: approved",
  p3: "review: approved",
};

export const KIMI_K2_5_MODEL = "@cf/moonshotai/kimi-k2.5";
export const KIMI_K2_6_MODEL = "@cf/moonshotai/kimi-k2.6";
export const DEPRECATED_MODEL_ALIASES: Record<string, string> = {
  [KIMI_K2_5_MODEL]: KIMI_K2_6_MODEL,
};

export const REPO_CONFIG_CACHE_VERSION = "v7";

export const DEFAULT_OVERALL_CORRECTNESS = "patch is correct";
export const DEFAULT_OVERALL_EXPLANATION = "Review completed (partial output).";
