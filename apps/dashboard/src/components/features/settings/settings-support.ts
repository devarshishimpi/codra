import type { LlmApiFormat, LlmProvider } from "@codraoss/schema";
import {
  REVIEW_CONCURRENCY_LIMITS,
  reviewMaxCommentsOptions,
  type ReviewConcurrencyLevel,
} from "@codraoss/schema/review-limits";

// Pure and render-free, so the settings page and its sections can all depend on it without depending on each other.

export const API_FORMAT_OPTIONS: Array<{ value: LlmApiFormat; label: string }> =
  [
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
    { value: "gemini", label: "Google" },
    { value: "vertex", label: "Google Vertex AI" },
    { value: "cloudflare-workers-ai", label: "Cloudflare" },
  ];

export const PROVIDER_PRESETS = [
  {
    value: "custom-openai",
    label: "Custom OpenAI-style API",
    apiFormat: "openai" as const,
    baseUrl: "",
    name: "Custom OpenAI",
    exampleUrl: "https://api.example.com/v1",
  },
  {
    value: "custom-anthropic",
    label: "Custom Anthropic-style API",
    apiFormat: "anthropic" as const,
    baseUrl: "",
    name: "Custom Anthropic",
    exampleUrl: "https://api.example.com/v1",
  },
  {
    value: "custom-google",
    label: "Custom Google-style API",
    apiFormat: "gemini" as const,
    baseUrl: "",
    name: "Custom Google",
    exampleUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  {
    value: "custom-vertex",
    label: "Google Vertex AI",
    apiFormat: "vertex" as const,
    baseUrl: "",
    name: "Vertex AI",
    exampleUrl:
      "https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us-central1",
  },
];

export const FIXED_PROVIDER_NAMES = new Set([
  "OpenAI",
  "OpenRouter",
  "Anthropic",
  "Google",
  "Cloudflare",
  "xAI",
  "NVIDIA",
]);

export function providerKeyPlaceholder(
  providerName: string,
  apiFormat: LlmApiFormat,
) {
  if (apiFormat === "vertex") return '{ "type": "service_account", … }';
  if (providerName === "xAI") return "xai-…";
  if (providerName === "NVIDIA") return "nvapi-…";
  return "sk-…";
}

export function apiKeyFieldLabel(apiFormat: LlmApiFormat) {
  return apiFormat === "vertex" ? "Service account JSON key" : "API key";
}

export const CONCURRENCY_LEVEL_ORDER: ReviewConcurrencyLevel[] = [
  "low",
  "medium",
  "high",
  "max",
];
export const CONCURRENCY_LEVEL_LABEL: Record<ReviewConcurrencyLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};
export const CONCURRENCY_STEPS = CONCURRENCY_LEVEL_ORDER.map((level) => ({
  value: REVIEW_CONCURRENCY_LIMITS[level],
  label: CONCURRENCY_LEVEL_LABEL[level],
}));
export const CONCURRENCY_VALUE_TO_LEVEL: Record<
  number,
  ReviewConcurrencyLevel
> = Object.fromEntries(
  CONCURRENCY_LEVEL_ORDER.map((level) => [
    REVIEW_CONCURRENCY_LIMITS[level],
    level,
  ]),
) as Record<number, ReviewConcurrencyLevel>;
export const CONCURRENCY_MAX_VALUE = REVIEW_CONCURRENCY_LIMITS.max;
export const MAX_COMMENTS_STEPS = reviewMaxCommentsOptions.map((n) => ({
  value: n,
  label: String(n),
}));
export const MAX_COMMENTS_CEILING =
  reviewMaxCommentsOptions[reviewMaxCommentsOptions.length - 1];

export type ProviderDraft = LlmProvider & { apiKey: string };
export type NewProviderDraft = {
  preset: string;
  name: string;
  apiFormat: LlmApiFormat;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
};
export type SyncError = {
  providerId: string;
  providerName: string;
  error: string;
};

export function providerToDraft(provider: LlmProvider): ProviderDraft {
  return { ...provider, apiKey: "" };
}

export function domId(prefix: string, value: string) {
  return `${prefix}-${value.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

export function isCustomProvider(
  provider: Pick<LlmProvider, "name" | "apiFormat">,
) {
  return (
    provider.apiFormat !== "cloudflare-workers-ai" &&
    !FIXED_PROVIDER_NAMES.has(provider.name)
  );
}

export function providerIsReady(
  provider: Pick<LlmProvider, "enabled" | "hasApiKey" | "apiFormat">,
) {
  return (
    provider.enabled &&
    (provider.hasApiKey || provider.apiFormat === "cloudflare-workers-ai")
  );
}

export function providerHasCredential(
  provider: Pick<ProviderDraft, "hasApiKey" | "apiFormat" | "apiKey">,
) {
  return (
    provider.apiFormat === "cloudflare-workers-ai" ||
    provider.hasApiKey ||
    provider.apiKey.trim().length > 0
  );
}

export function providerStatusLabel(
  provider: Pick<LlmProvider, "enabled" | "hasApiKey" | "apiFormat">,
) {
  if (!provider.enabled) return "Off";
  return providerIsReady(provider) ? "Ready" : "Needs key";
}

export function providerDraftDirty(
  provider: ProviderDraft,
  saved?: LlmProvider,
) {
  if (!saved) return true;
  return (
    provider.name !== saved.name ||
    provider.apiFormat !== saved.apiFormat ||
    (provider.baseUrl ?? "") !== (saved.baseUrl ?? "") ||
    provider.enabled !== saved.enabled ||
    provider.apiKey.trim().length > 0
  );
}
