import { createSharedApiDeps } from '@codraoss/api';
import type { NodeAppBindings } from './env';
import { logger } from '@codraoss/api/logger';
import { createReviewRuntime } from './runtime';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

export function createNodeApiDeps(env: NodeAppBindings) {
  return createSharedApiDeps({
    sessionStore: env.SESSION_STORE,
    kv: env.APP_KV,
    db: { HYPERDRIVE: env.DATABASE_CONFIG, APP_KV: env.APP_KV, workerMode: false },
    identityProvider: env.IDENTITY_PROVIDER,

    enqueueReviewJob: async (input) => {
      await env.REVIEW_QUEUE.send(input);
    },
    terminateJobWorkflow: async (job) => {
      const workerQueue = new Queue('codra-reviews', { connection: new Redis(process.env.REDIS_URL || 'redis://localhost:6379') });
      const bullMqJob = await workerQueue.getJob(job.id);
      if (bullMqJob) {
        await bullMqJob.remove();
        logger.info(`[API Deps] Terminated job workflow for job ${job.id}`);
      } else {
        logger.warn(`[API Deps] Attempted to terminate non-existent or completed job ${job.id}`);
      }
      await workerQueue.close();
    },
    scheduleBestEffortJobMaintenance: () => {
      // In node, this is a long running process, we can just spawn a promise.
    },
    createReviewRuntime: () => createReviewRuntime(env),
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
