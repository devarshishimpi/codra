import { createSharedApiDeps } from '@codraoss/api';
import type { NodeAppBindings } from './env';
import { logger } from '@codraoss/api/logger';

export function createNodeApiDeps(env: NodeAppBindings) {
  return createSharedApiDeps({
    sessionStore: env.SESSION_STORE,
    kv: env.APP_KV,
    db: { HYPERDRIVE: env.HYPERDRIVE, APP_KV: env.APP_KV, workerMode: false },
    identityProvider: env.IDENTITY_PROVIDER,

    enqueueReviewJob: async (input) => {
      await env.REVIEW_QUEUE.send(input);
    },
    terminateJobWorkflow: async (job) => {
      logger.warn('[STUB] terminateJobWorkflow called');
    },
    scheduleBestEffortJobMaintenance: () => {
      // In node, this is a long running process, we can just spawn a promise.
    },
    createReviewRuntime: () => {
      throw new Error('Review runtime not implemented for Node yet.');
    },
    getOrFetchRawDiffForCompletedJob: async () => '',
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
