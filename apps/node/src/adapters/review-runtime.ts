import type { ReviewRuntime } from '@codraoss/core/ports';
import type { DbEnv } from '@codraoss/db/env';
import { TokenTracker } from '@codraoss/core/token-tracker';
import { FormatterService } from '@codraoss/core/formatter';
import { GitHubService } from '@codraoss/provider-github';
import { isRetryableModelError, ModelRunner, nextChainIndexOf } from '@codraoss/models';
import { getResolvedModelConfig } from '@codraoss/db/model-configs';
import {
  makeFileReviewStore,
  makeJobStore,
  makeLearningStore,
  makeModelConfigReader,
  makeReviewSettingsReader,
  makeWebhookDeliveryReader,
} from '@codraoss/db/repositories';
import { loadRepoConfig } from '@codraoss/api/platform';
import type { NodeAppBindings } from '../env';
import { makeTelemetrySink } from './telemetry';

// The Node composition root: the one place Postgres, Redis and the GitHub/model services are wired
// to the engine's ports, mirroring apps/worker/src/adapters/index.ts. @codraoss/core sees this
// object and nothing else.
//
// Thinner than the Worker's because the stores take a DbEnv rather than Cloudflare bindings, and
// because there is no Workers AI binding: Cloudflare-hosted models are unavailable on this target,
// every other provider is reached over HTTP exactly as it is on Workers.
export function createReviewRuntime(env: NodeAppBindings): ReviewRuntime {
  const dbEnv: DbEnv = { HYPERDRIVE: env.HYPERDRIVE, APP_KV: env.APP_KV, workerMode: false };

  return {
    kv: {
      get: (key) => env.APP_KV.get(key),
      put: (key, value, options) => env.APP_KV.put(key, value, options),
    },
    clock: { now: () => Date.now() },
    ids: { randomUUID: () => crypto.randomUUID() },

    botUsername: env.BOT_USERNAME,

    jobs: makeJobStore(dbEnv),
    fileReviews: makeFileReviewStore(dbEnv),
    settings: makeReviewSettingsReader(dbEnv),
    webhooks: makeWebhookDeliveryReader(dbEnv),
    learning: makeLearningStore(dbEnv),
    modelConfigs: makeModelConfigReader(dbEnv),
    repoConfig: { loadRepoConfig: (input) => loadRepoConfig(env.APP_KV, dbEnv, input) },
    telemetry: makeTelemetrySink(env, dbEnv),

    createTokenTracker: () => new TokenTracker(),
    createGitHub: (installationId, tracker) => new GitHubService(env, installationId, tracker),
    createModel: (jobId, tracker) => new ModelRunner({
      kv: env.APP_KV,
      secretStore: { getSecret: async (key) => (env[key as keyof NodeAppBindings] as string | undefined) ?? process.env[key] ?? null },
      getConfig: (modelId) => getResolvedModelConfig(dbEnv, modelId),
      tracker,
      jobId,
    }),
    createFormatter: () => new FormatterService(env.APP_URL),

    githubClients: { forInstallation: (installationId) => new GitHubService(env, installationId) },
    modelErrors: { isRetryableModelError, nextChainIndexOf },
  };
}
