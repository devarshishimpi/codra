import { logger } from "../logger";
import { normalizeModelId, type RepoConfig } from "@codraoss/schema";
import {
  isSubrequestBudgetMessage,
  isTimeoutMessage,
  matchesAnyTransientSubstring,
} from "@codraoss/schema/transient-errors";
import type { ReviewRuntime } from "../ports";
import { RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS } from "../constants";

export function isRetryableFileReviewErrorMessage(
  message: string | null | undefined,
) {
  if (!message) return false;
  const lower = message.toLowerCase();

  if (
    lower.includes("retrying later") ||
    lower.includes("all configured review models failed")
  ) {
    return true;
  }

  if (isTimeoutMessage(lower)) {
    return false;
  }

  return (
    matchesAnyTransientSubstring(lower) ||
    lower.includes("google request failed with 5") ||
    lower.includes("temporary") ||
    lower.includes("subrequest")
  );
}

export function isSubrequestBudgetError(error: unknown): boolean {
  return isSubrequestBudgetMessage(error);
}

export function retryableModelFailureDelaySeconds(
  failureCount: number | null | undefined,
) {
  if (!failureCount || failureCount < 1)
    return RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS[0];
  const index = Math.min(
    failureCount - 1,
    RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS.length - 1,
  );
  return RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS[index];
}

export function getRetryableModelFailureDelaySeconds(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as { retryAfterSeconds?: unknown })
      : null;
  const retryAfterSeconds =
    typeof record?.retryAfterSeconds === "number"
      ? record.retryAfterSeconds
      : null;
  return retryAfterSeconds ?? RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS[0];
}

export function shouldRetryExistingFileReview(review: {
  file_status: string;
  error_msg: string | null;
}) {
  return (
    review.file_status === "failed" &&
    isRetryableFileReviewErrorMessage(review.error_msg)
  );
}

export function countsAsHandledFileReview(review: {
  file_status: string;
  error_msg: string | null;
}) {
  return !shouldRetryExistingFileReview(review);
}

export function isAwaitingAsyncReview(review: {
  file_status: string;
  async_request_id?: string | null;
}) {
  return review.file_status === "pending" && !!review.async_request_id;
}

export function bareModelId(model: string): string {
  const normalized = normalizeModelId(model);
  const colon = normalized.indexOf(":");
  return colon === -1 ? normalized : normalized.slice(colon + 1);
}

export function configuredModelSet(config: RepoConfig) {
  const models = new Set<string>();
  const addModel = (model: string | null | undefined) => {
    if (model) models.add(bareModelId(model));
  };

  addModel(config.model?.main);
  for (const fallback of config.model?.fallbacks ?? []) {
    addModel(fallback);
  }
  for (const tier of config.model?.size_overrides ?? []) {
    addModel(tier.model);
    for (const fallback of tier.fallbacks ?? []) {
      addModel(fallback);
    }
  }

  return models;
}

export function canInheritParentFileReview(
  config: RepoConfig,
  review: { model_used: string },
) {
  return configuredModelSet(config).has(bareModelId(review.model_used));
}

export async function resolveModelProviderName(
  env: Pick<ReviewRuntime, "modelConfigs">,
  modelId: string | null | undefined,
) {
  if (!modelId || modelId === "unconfigured") return null;

  try {
    const resolved = await env.modelConfigs.getResolvedModelConfig(
      normalizeModelId(modelId),
    );
    return resolved?.providerName ?? null;
  } catch (error) {
    logger.warn(`Failed to resolve provider for model ${modelId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
