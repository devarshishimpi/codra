import type {
  LearningStore,
  ModelConfigReader,
  ReviewSettingsReader,
  WebhookDeliveryReader,
} from "@codraoss/core/ports";
import type { DbEnv } from "../env";
import { getReviewSettings } from "../app-settings";
import { getResolvedModelConfig } from "../model-configs";
import { getWebhookDelivery } from "../webhook-deliveries";
import { getRejectedExemplars, getRepositoryIdForJob } from "../learning";

export function makeReviewSettingsReader(env: DbEnv): ReviewSettingsReader {
  return { getReviewSettings: () => getReviewSettings(env) };
}

export function makeModelConfigReader(env: DbEnv): ModelConfigReader {
  // Returns the full ResolvedModelConfig, which the narrower port type discards -- deliberately, so
  // encryptedApiKey has no path into the engine.
  return {
    getResolvedModelConfig: (modelId) => getResolvedModelConfig(env, modelId),
  };
}

export function makeWebhookDeliveryReader(env: DbEnv): WebhookDeliveryReader {
  return {
    getWebhookDelivery: (deliveryId) => getWebhookDelivery(env, deliveryId),
  };
}

export function makeLearningStore(env: DbEnv): LearningStore {
  return {
    getRepositoryIdForJob: (jobId) => getRepositoryIdForJob(env, jobId),
    getRejectedExemplars: (input) => getRejectedExemplars(env, input),
  };
}
