import { createSharedApiDeps } from "@codraoss/api";
import type { NodeAppBindings } from "./env";
import { logger } from "@codraoss/api/logger";
import { createReviewRuntime } from "./runtime";

export function createNodeApiDeps(env: NodeAppBindings) {
  return createSharedApiDeps({
    sessionStore: env.SESSION_STORE,
    kv: env.APP_KV,
    db: {
      HYPERDRIVE: env.DATABASE_CONFIG,
      APP_KV: env.APP_KV,
      workerMode: false,
    },
    identityProvider: env.IDENTITY_PROVIDER,

    enqueueReviewJob: async (input) => {
      await env.REVIEW_QUEUE.send(input);
    },
    terminateJobWorkflow: async (job) => {
      if (env.REVIEW_QUEUE.deleteJob) {
        try {
          await env.REVIEW_QUEUE.deleteJob(job.id);
          logger.info(`[API Deps] Terminated job workflow for job ${job.id}`);
        } catch (error) {
          logger.error(
            `[API Deps] Failed to terminate job workflow for job ${job.id}: ${error}`,
          );
          throw error;
        }
      } else {
        logger.warn(
          `[API Deps] QueueAdapter does not support deleteJob. Cannot terminate ${job.id}`,
        );
      }
    },
    scheduleBestEffortJobMaintenance: () => {},
    createReviewRuntime: () => createReviewRuntime(env),
    getOrFetchRawDiffForCompletedJob: async () => "",
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
