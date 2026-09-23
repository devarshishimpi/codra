import type { ReviewRuntime } from '@codraoss/core/ports';
import type { DbEnv } from '@codraoss/db/env';
import { TokenTracker } from '@codraoss/core/token-tracker';
import type { NodeAppBindings } from './env';


import { makeJobStore, makeFileReviewStore, makeLearningStore, makeModelConfigReader, makeReviewSettingsReader, makeWebhookDeliveryReader } from '@codraoss/db/repositories';


import { loadRepoConfig } from '@codraoss/api/platform';


import { cryptoIds, systemClock } from '@codraoss/node-adapters';
import { makeTelemetrySink } from './adapters/telemetry';
import {
  makeFormatterFactory,
  makeGitHubClientFactory,
  makeGitHubFactory,
  makeModelErrorClassifier,
  makeModelFactory,
} from './adapters/services';

export function createReviewRuntime(env: NodeAppBindings): ReviewRuntime & DbEnv {
  const dbEnv = { HYPERDRIVE: env.DATABASE_CONFIG, APP_KV: env.APP_KV, workerMode: false };

  return {
    ...dbEnv,
    kv: env.APP_KV,
    clock: systemClock,
    ids: cryptoIds,

    botUsername: env.BOT_USERNAME,

    jobs: makeJobStore(dbEnv),
    fileReviews: makeFileReviewStore(dbEnv),
    settings: makeReviewSettingsReader(dbEnv),
    webhooks: makeWebhookDeliveryReader(dbEnv),
    learning: makeLearningStore(dbEnv),
    modelConfigs: makeModelConfigReader(dbEnv),
    repoConfig: {
      loadRepoConfig: (context) => loadRepoConfig(env.APP_KV, dbEnv, context)
    },
    telemetry: makeTelemetrySink(env),

    createTokenTracker: () => new TokenTracker(),
    createGitHub: makeGitHubFactory(env),
    createModel: makeModelFactory(env),
    createFormatter: makeFormatterFactory(env),

    githubClients: makeGitHubClientFactory(env),
    modelErrors: makeModelErrorClassifier(),
  };
}
