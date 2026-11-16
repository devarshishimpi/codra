import type { ReviewRuntime } from "@codraoss/core/ports";
import type { DbEnv } from "@codraoss/db/env";
import {
  TokenTracker,
  type TokenTrackerOptions,
} from "@codraoss/core";
import type { NodeAppBindings } from "./env";

export function resolveNodeSubrequestLimits(
  env?: Partial<NodeAppBindings>,
): TokenTrackerOptions {
  const envLimit =
    env?.SUBREQUEST_LIMIT ??
    env?.CF_SUBREQUEST_LIMIT ??
    process.env.SUBREQUEST_LIMIT ??
    process.env.CF_SUBREQUEST_LIMIT;
  if (envLimit !== undefined) {
    const limit = Number(envLimit);
    if (!Number.isNaN(limit) && limit > 0) {
      return { maxSubrequests: limit };
    }
  }
  return { maxSubrequests: Number.POSITIVE_INFINITY };
}

import {
  makeJobStore,
  makeFileReviewStore,
  makeLearningStore,
  makeModelConfigReader,
  makeReviewSettingsReader,
  makeWebhookDeliveryReader,
} from "@codraoss/db/repositories";

import { loadRepoConfig } from "@codraoss/api/platform";

import { cryptoIds, systemClock } from "@codraoss/node-adapters";
import { makeTelemetrySink } from "./adapters/telemetry";
import {
  makeFormatterFactory,
  makeGitHubClientFactory,
  makeGitHubFactory,
  makeModelErrorClassifier,
  makeModelFactory,
} from "./adapters/services";

export function createReviewRuntime(
  env: NodeAppBindings,
): ReviewRuntime & DbEnv {
  const dbEnv = {
    HYPERDRIVE: env.DATABASE_CONFIG,
    APP_KV: env.APP_KV,
    workerMode: false,
  };

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
      loadRepoConfig: (context) => loadRepoConfig(env.APP_KV, dbEnv, context),
    },
    telemetry: makeTelemetrySink(env),

    createTokenTracker: () => new TokenTracker(resolveNodeSubrequestLimits(env)),
    createGitHub: makeGitHubFactory(env),
    createModel: makeModelFactory(env),
    createFormatter: makeFormatterFactory(env),

    githubClients: makeGitHubClientFactory(env),
    modelErrors: makeModelErrorClassifier(),
  };
}
