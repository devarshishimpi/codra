export const reviewTriggers = ["auto", "mention", "retry"] as const;
export const jobStatuses = [
  "queued",
  "running",
  "done",
  "failed",
  "superseded",
  "cancelled",
  "stopped",
] as const;
export const fileStatuses = ["pending", "done", "skipped", "failed"] as const;
export const reviewVerdicts = ["approve", "comment"] as const;
export const reviewCategories = [
  "security",
  "bugs",
  "performance",
  "correctness",
  "quality",
] as const;
export const llmApiFormats = [
  "openai",
  "anthropic",
  "gemini",
  "cloudflare-workers-ai",
  "vertex",
] as const;
