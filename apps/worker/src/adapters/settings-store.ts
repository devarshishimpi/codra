import type { AppBindings } from '../env';
import type { LearningStore, ModelConfigReader, RepoConfigLoader, ReviewSettingsReader, WebhookDeliveryReader } from '@codraoss/core/ports';
import { makeLearningStore as makeDbLearningStore, makeModelConfigReader as makeDbModelConfigReader, makeReviewSettingsReader as makeDbReviewSettingsReader, makeWebhookDeliveryReader as makeDbWebhookDeliveryReader } from '@codraoss/db/repositories';
import type { DbEnv } from '@codraoss/db/env';
import { loadRepoConfig } from '../core/config';

function toDbEnv(env: AppBindings): DbEnv {
  return {
    HYPERDRIVE: env.HYPERDRIVE,
    APP_KV: env.APP_KV,
    workerMode: true,
  };
}

export function makeReviewSettingsReader(env: AppBindings): ReviewSettingsReader {
  return makeDbReviewSettingsReader(toDbEnv(env));
}

export function makeModelConfigReader(env: AppBindings): ModelConfigReader {
  return makeDbModelConfigReader(toDbEnv(env));
}

export function makeWebhookDeliveryReader(env: AppBindings): WebhookDeliveryReader {
  return makeDbWebhookDeliveryReader(toDbEnv(env));
}

export function makeLearningStore(env: AppBindings): LearningStore {
  return makeDbLearningStore(toDbEnv(env));
}

export function makeRepoConfigLoader(env: AppBindings): RepoConfigLoader {
  return { loadRepoConfig: (input) => loadRepoConfig(env.APP_KV, toDbEnv(env), input) };
}
