import { createSharedApiDeps } from '@codraoss/api';
import { getOrFetchRawDiffForCompletedJob } from '@codraoss/core';
import type { NodeAppBindings } from './env';
import { logger } from '@codraoss/api/logger';
import { createReviewRuntime } from './adapters/review-runtime';

export function createNodeApiDeps(env: NodeAppBindings) {
  return createSharedApiDeps({
    sessionStore: env.SESSION_STORE,
    kv: env.APP_KV,
    db: { HYPERDRIVE: env.HYPERDRIVE, APP_KV: env.APP_KV, workerMode: false },
    identityProvider: env.IDENTITY_PROVIDER,

    enqueueReviewJob: async (input) => {
      await env.REVIEW_QUEUE.send(input);
    },
    // There is no durable instance to terminate: a Node review runs inside its BullMQ job. The stop
    // and rerun routes call this BEFORE cancelling, to stop the old run racing the new one, and a
    // no-op cannot honour that -- the loop keeps working the current phase until it next reads the
    // job's status and sees it is terminal. Closing that gap needs a cooperative cancel signal the
    // loop polls; until then, stop is eventually-effective rather than immediate.
    terminateJobWorkflow: async () => {},
    scheduleBestEffortJobMaintenance: () => {
      // In node, this is a long running process, we can just spawn a promise.
    },
    createReviewRuntime: () => createReviewRuntime(env),
    getOrFetchRawDiffForCompletedJob,
    logger,
    getSecret: async (key) => process.env[key] ?? null,

    aiBinding: undefined,
    appUrl: env.APP_URL,
    botUsername: env.BOT_USERNAME,
    environment: env.ENVIRONMENT,
    authCallbackUrl: env.AUTH_CALLBACK_URL,
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
    githubAppSlug: env.GITHUB_APP_SLUG,
    dashboardAllowedUsers: env.DASHBOARD_ALLOWED_USERS,
    appPrivateKey: env.APP_PRIVATE_KEY,
    githubAppId: env.GITHUB_APP_ID,
    githubAppWebhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
    llmConfigEncryptionKey: env.LLM_CONFIG_ENCRYPTION_KEY,
  });
}
