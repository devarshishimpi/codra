import { createSharedApiDeps } from '@codraoss/api';
import type { AppBindings } from './env';
import { CloudflareSessionStore } from './sessions';
import { createReviewRuntime } from './adapters';
import { logger } from './core/logger';
import { getOrFetchRawDiffForCompletedJob } from './core/review';

export function createApiRouterDeps(env: AppBindings, _ctx: ExecutionContext) {
  return createSharedApiDeps({
    sessionStore: new CloudflareSessionStore(env.APP_KV),
    kv: env.APP_KV,
    db: { HYPERDRIVE: env.HYPERDRIVE, APP_KV: env.APP_KV, workerMode: true },
    identityProvider: env.IDENTITY_PROVIDER,
    enqueueReviewJob: async (input) => await env.REVIEW_QUEUE.send(input),
    terminateJobWorkflow: async (job) => {
      if (job.workflowInstanceId) {
        try {
          const instance = await env.REVIEW_WORKFLOW.get(job.workflowInstanceId);
          await instance.terminate();
        } catch (e) { /* ignore */ }
      }
    },
    scheduleBestEffortJobMaintenance: (execCtx) => {
      try {
        execCtx?.waitUntil(import('./core/job-recovery').then(m => m.runBestEffortJobMaintenance(env)));
      } catch { /* ignore */ }
    },
    createReviewRuntime: () => createReviewRuntime(env),
    getOrFetchRawDiffForCompletedJob,
    logger,
    getSecret: async (key) => (env[key as keyof AppBindings] as string | undefined) ?? null,
    aiBinding: env.AI,
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
    cfApiToken: env.CF_API_TOKEN,
    cfAccountId: env.CF_ACCOUNT_ID,
  });
}
