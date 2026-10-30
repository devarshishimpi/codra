export interface PlatformDeps {
  sessionStore: SessionStore;
  kv: KvCompat;
  db: DbEnv;
  identityProvider?: IdentityProvider;

  enqueueReviewJob: (input: any) => Promise<void>;
  terminateJobWorkflow: (job: {
    id: string;
    workflowInstanceId?: string | null;
  }) => Promise<void>;
  scheduleBestEffortJobMaintenance: (executionContext?: any) => void;
  createReviewRuntime: () => ReviewRuntime;
  getOrFetchRawDiffForCompletedJob: (
    runtime: ReviewRuntime,
    job: any,
    github: any,
  ) => Promise<string>;

  logger: PlatformPort["logger"];
  getSecret: (key: string) => Promise<string | null>;

  aiBinding?: any;
  cloudflareAiEnabled?: boolean;
  appUrl: string;
  botUsername: string;
  environment: string;
  authCallbackUrl: string;
  githubClientId: string;
  githubClientSecret: string;
  githubAppSlug?: string;
  dashboardAllowedUsers: string;
  appPrivateKey: string;
  githubAppId: string;
  githubAppWebhookSecret: string;
  llmConfigEncryptionKey: string;
  cfApiToken?: string;
  cfAccountId?: string;
}

import type { ApiRouterDeps, PlatformPort } from "./ports";
import type {
  SessionStore,
  ReviewRuntime,
  IdentityProvider,
} from "@codraoss/core/ports";
import type { KvCompat } from "./platform/config";
import type { DbEnv } from "@codraoss/db/env";

import * as dbAccounts from "@codraoss/db/accounts";
import * as dbJobs from "@codraoss/db/jobs";
import * as dbFileReviews from "@codraoss/db/file-reviews";
import * as dbCommentFeedback from "@codraoss/db/comment-feedback";
import * as dbModelConfigs from "@codraoss/db/model-configs";
import * as dbRepoConfigs from "@codraoss/db/repo-configs";
import * as dbAppSettings from "@codraoss/db/app-settings";
import * as dbStats from "@codraoss/db/stats";
import * as dbWebhookDeliveries from "@codraoss/db/webhook-deliveries";

import {
  GitHubClient,
  normalizeGitHubWebhook,
} from "@codraoss/provider-github";
import { GitHubIdentityProvider } from "@codraoss/provider-github/oauth";
import {
  getGlobalConfig,
  updateGlobalConfig,
  loadRepoConfig,
  invalidateRepoConfigCache,
} from "./platform/config";

import {
  getUpdatesEmailPreference,
  syncUpdatesEmail,
} from "./platform/updates-email";

import { extractReviewRequest } from "@codraoss/core";

import { createOAuthState, consumeOAuthState } from "./platform/oauth";

import { verifyGitHubWebhookSignature } from "@codraoss/core/verify";

import { createModelRunnerDeps } from "./model-runner-deps";

function toAppBindingsConfig(p: PlatformDeps) {
  return {
    APP_KV: p.kv,
    APP_PRIVATE_KEY: p.appPrivateKey,
    GITHUB_APP_ID: p.githubAppId,
    BOT_USERNAME: p.botUsername,
    GITHUB_APP_SLUG: p.githubAppSlug,
    GITHUB_CLIENT_ID: p.githubClientId,
    GITHUB_CLIENT_SECRET: p.githubClientSecret,
    AUTH_CALLBACK_URL: p.authCallbackUrl,
  };
}

// `IDENTITY_PROVIDER` is a test-only seam; production has no such binding.
const githubIdentity = new GitHubIdentityProvider();
function identityProvider(p: PlatformDeps) {
  return p.identityProvider ?? githubIdentity;
}

export function createSharedApiDeps(p: PlatformDeps): ApiRouterDeps {
  return {
    cloudflareAiEnabled: p.cloudflareAiEnabled,
    repositories: {
      accounts: dbAccounts,
      jobs: dbJobs,
      fileReviews: dbFileReviews,
      commentFeedback: dbCommentFeedback,
      modelConfigs: dbModelConfigs,
      repoConfigs: dbRepoConfigs,
      appSettings: dbAppSettings,
      stats: dbStats,
      webhookDeliveries: dbWebhookDeliveries,
    },
    gitProvider: {
      getAppInstallationUrl: async () =>
        await GitHubClient.getAppInstallationUrl(toAppBindingsConfig(p)),
      listInstallations: async () =>
        await GitHubClient.listInstallations(toAppBindingsConfig(p)),
      createService: (installationId?: number | string | null) =>
        new GitHubClient(
          toAppBindingsConfig(p),
          installationId != null ? String(installationId) : undefined,
        ),
    },
    config: {
      getGlobalConfig: async () => await getGlobalConfig(p.kv),
      updateGlobalConfig: async (config: any) =>
        await updateGlobalConfig(p.kv, config),
      loadRepoConfig: async (input: any) =>
        await loadRepoConfig(p.kv, p.db, input),
      invalidateRepoConfigCache: async (owner: string, repo: string) =>
        await invalidateRepoConfigCache(p.kv, owner, repo),
    },
    modelRunner: createModelRunnerDeps(p),
    sessionStore: p.sessionStore,
    platform: {
      scheduleBestEffortJobMaintenance: p.scheduleBestEffortJobMaintenance,
      createReviewRuntime: p.createReviewRuntime,
      getUpdatesEmailPreference: async (githubUserId: number) =>
        await getUpdatesEmailPreference(p.kv, githubUserId),
      syncUpdatesEmail: async (
        githubUserId: number,
        email: string | null | undefined,
      ) => await syncUpdatesEmail(p.kv, githubUserId, email),
      terminateJobWorkflow: p.terminateJobWorkflow,
      enqueueReviewJob: p.enqueueReviewJob,
      getOrFetchRawDiffForCompletedJob: p.getOrFetchRawDiffForCompletedJob,
      logger: p.logger,
    },
    authProvider: {
      createOAuthState: async () => await createOAuthState(p.kv),
      consumeOAuthState: async (state: string) =>
        await consumeOAuthState(p.kv, state),
      beginAuthorization: async (callbackUrl: string, state: string) =>
        await identityProvider(p).beginAuthorization(
          callbackUrl,
          state,
          toAppBindingsConfig(p) as any,
        ),
      completeAuthorization: async (
        code: string,
        state: string,
        expectedState: string,
      ) =>
        await identityProvider(p).completeAuthorization(
          code,
          state,
          expectedState,
          toAppBindingsConfig(p) as any,
        ),
    },
    webhook: {
      verifySignature: async (signature: string | null, body: string) =>
        await verifyGitHubWebhookSignature(
          p.githubAppWebhookSecret,
          signature,
          body,
        ),
      normalizePayload: (eventName: string, payload: any) =>
        normalizeGitHubWebhook(eventName, payload),
      extractReviewRequest: (input: any) => extractReviewRequest(input),
    },
  };
}
