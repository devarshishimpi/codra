import type { ReviewRuntime } from "@codraoss/core/ports";
import {
  TokenTracker,
  type TokenTrackerOptions,
  DEFAULT_MAX_SUBREQUESTS,
  DEFAULT_SUBREQUEST_SAFE_MARGIN,
  PAID_WORKER_MAX_SUBREQUESTS,
} from "@codraoss/core";
import type { AppBindings } from "../env";

export function resolveWorkerSubrequestLimits(
  env: Partial<AppBindings>,
): TokenTrackerOptions {
  if (env.CF_SUBREQUEST_LIMIT !== undefined) {
    const limit = Number(env.CF_SUBREQUEST_LIMIT);
    if (!Number.isNaN(limit) && limit > 0) {
      return { maxSubrequests: limit };
    }
  }
  const isPaid =
    env.CF_PAID_WORKER === true ||
    env.CF_PAID_WORKER === "true" ||
    env.CF_PAID_WORKER === "1";
  if (isPaid) {
    return { maxSubrequests: PAID_WORKER_MAX_SUBREQUESTS };
  }
  return {
    maxSubrequests: DEFAULT_MAX_SUBREQUESTS,
    safeMargin: DEFAULT_SUBREQUEST_SAFE_MARGIN,
  };
}
// Imported for its side effect as well as never: this installs the AsyncLocalStorage-backed logger as
// the sink @codraoss/core's logger facade delegates to. Explicit here so engine log lines carry request
// context by construction, rather than because some other module happened to be loaded first.
import "../core/logger";
import {
  cryptoIds,
  makeKvStore,
  makeTelemetrySink,
  systemClock,
} from "./platform";
import { makeJobStore } from "./jobs-store";
import { makeFileReviewStore } from "./file-review-store";
import {
  makeLearningStore,
  makeModelConfigReader,
  makeRepoConfigLoader,
  makeReviewSettingsReader,
  makeWebhookDeliveryReader,
} from "./settings-store";
import {
  makeFormatterFactory,
  makeGitHubClientFactory,
  makeGitHubFactory,
  makeModelErrorClassifier,
  makeModelFactory,
} from "./services";

// The composition root: the one place Cloudflare bindings, Postgres and the GitHub/model services are
// wired to the engine's ports. @codraoss/core sees this object and nothing else.
//
// Called once per Worker invocation, before the job is known. It only allocates closures, so it is
// cheap enough to build on the webhook path too.
export function createReviewRuntime(env: AppBindings): ReviewRuntime {
  return {
    kv: makeKvStore(env),
    clock: systemClock,
    ids: cryptoIds,

    botUsername: env.BOT_USERNAME,

    jobs: makeJobStore(env),
    fileReviews: makeFileReviewStore(env),
    settings: makeReviewSettingsReader(env),
    webhooks: makeWebhookDeliveryReader(env),
    learning: makeLearningStore(env),
    modelConfigs: makeModelConfigReader(env),
    repoConfig: makeRepoConfigLoader(env),
    telemetry: makeTelemetrySink(env),

    createTokenTracker: () => new TokenTracker(resolveWorkerSubrequestLimits(env)),
    createGitHub: makeGitHubFactory(env),
    createModel: makeModelFactory(env),
    createFormatter: makeFormatterFactory(env),

    githubClients: makeGitHubClientFactory(env),
    modelErrors: makeModelErrorClassifier(),
  };
}
