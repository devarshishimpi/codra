
export interface PlatformDeps {
  sessionStore: SessionStore;
  kv: KvCompat;
  db: DbEnv;
  identityProvider?: IdentityProvider;
  
  enqueueReviewJob: (input: any) => Promise<void>;
  terminateJobWorkflow: (job: { id: string; workflowInstanceId?: string | null }) => Promise<void>;
  scheduleBestEffortJobMaintenance: (executionContext?: any) => void;
  createReviewRuntime: () => ReviewRuntime;
  getOrFetchRawDiffForCompletedJob: (runtime: ReviewRuntime, job: any, github: any) => Promise<string>;
  
  logger: PlatformPort['logger'];
  getSecret: (key: string) => Promise<string | null>;
  
  aiBinding?: any;
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

import type { ApiRouterDeps, PlatformPort } from './ports';
import type { SessionStore, KeyValueStore, ReviewRuntime, IdentityProvider } from '@codraoss/core/ports';
import type { KvCompat } from './platform/config';
import type { DbEnv } from '@codraoss/db/env';


import * as dbAccounts from '@codraoss/db/accounts';
import * as dbJobs from '@codraoss/db/jobs';
import * as dbFileReviews from '@codraoss/db/file-reviews';
import * as dbCommentFeedback from '@codraoss/db/comment-feedback';
import * as dbModelConfigs from '@codraoss/db/model-configs';
import * as dbRepoConfigs from '@codraoss/db/repo-configs';
import * as dbAppSettings from '@codraoss/db/app-settings';
import * as dbStats from '@codraoss/db/stats';
import * as dbWebhookDeliveries from '@codraoss/db/webhook-deliveries';

import { GitHubClient, normalizeGitHubWebhook } from '@codraoss/provider-github';
import { GitHubIdentityProvider } from '@codraoss/provider-github/oauth';
import { getGlobalConfig, updateGlobalConfig, loadRepoConfig, invalidateRepoConfigCache } from './platform/config';

import { getUpdatesEmailPreference, syncUpdatesEmail } from './platform/updates-email';

import { extractReviewRequest } from '@codraoss/core';

import { createOAuthState, consumeOAuthState } from './platform/oauth';

import { verifyGitHubWebhookSignature } from '@codraoss/core/verify';



// model sync dependencies
import { listLlmProviderSecrets, upsertDiscoveredModelConfigs, createLlmProvider, updateLlmProvider, getResolvedModelConfig, getLlmProvider } from '@codraoss/db/model-configs';
import { encryptLlmApiKey, decryptLlmApiKey, listProviderModels, reviewWithCloudflare, reviewWithGoogle, reviewWithVertex, reviewWithOpenAI, reviewWithAnthropic, ProviderRequestError } from '@codraoss/models';
import { buildReviewResponseSchema } from '@codraoss/core/prompts/file-review';

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

function getSecretStore(p: PlatformDeps) {
  return { getSecret: p.getSecret };
}

function optionalEnv(value: () => string) {
  try {
    const resolved = value().trim();
    return resolved.length > 0 ? resolved : undefined;
  } catch {
    return undefined;
  }
}

// `IDENTITY_PROVIDER` is a test-only seam; production has no such binding.
const githubIdentity = new GitHubIdentityProvider();
function identityProvider(p: PlatformDeps) {
  return p.identityProvider ?? githubIdentity;
}

export function createSharedApiDeps(p: PlatformDeps): ApiRouterDeps {
  return {
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
      getAppInstallationUrl: async () => await GitHubClient.getAppInstallationUrl(toAppBindingsConfig(p)),
      listInstallations: async () => await GitHubClient.listInstallations(toAppBindingsConfig(p)),
      createService: (installationId?: number | string | null) => new GitHubClient(toAppBindingsConfig(p), String(installationId)),
    },
    config: {
      getGlobalConfig: async () => await getGlobalConfig(p.kv),
      updateGlobalConfig: async (config: any) => await updateGlobalConfig(p.kv, config),
      loadRepoConfig: async (input: any) => await loadRepoConfig(p.kv, p.db, input),
      invalidateRepoConfigCache: async (owner: string, repo: string) => await invalidateRepoConfigCache(p.kv, owner, repo),
    },
    modelRunner: {
      syncProviderModelCatalog: async () => {
        const providers = await listLlmProviderSecrets(p.db);
        const syncErrors: Array<{ providerId: string; providerName: string; error: string }> = [];

        await Promise.all(providers.map(async (provider) => {
          if (!provider.enabled) return;
          if (provider.apiFormat !== 'cloudflare-workers-ai' && !provider.encryptedApiKey) return;

          try {
            const apiKey = provider.encryptedApiKey
              ? await decryptLlmApiKey(getSecretStore(p), provider.encryptedApiKey)
              : undefined;
            const modelNames = await listProviderModels({
              apiFormat: provider.apiFormat,
              baseUrl: provider.baseUrl,
              apiKey,
              cloudflareAccountId: optionalEnv(() => p.cfAccountId || ''),
              cloudflareApiToken: optionalEnv(() => p.cfApiToken || ''),
            });
            await upsertDiscoveredModelConfigs(p.db, {
              providerId: provider.id,
              providerName: provider.name,
              apiFormat: provider.apiFormat,
              modelNames,
            });
          } catch (error) {
            syncErrors.push({
              providerId: provider.id,
              providerName: provider.name,
              error: error instanceof Error ? error.message : 'Could not refresh provider models.',
            });
          }
        }));

        return syncErrors;
      },
      testConnection: async (modelId: string) => {
        const config = await getResolvedModelConfig(p.db, modelId);
        if (!config) throw { isNotFoundError: true };
        if (!config.providerEnabled) throw { isDisabledError: true, message: 'Provider is disabled.' };

        try {
          const input = {
            systemPrompt: 'You are validating connectivity. Return only the JSON object.',
            userPrompt: 'Return an empty review: no findings, overall_correctness "patch is correct".',
            responseSchema: buildReviewResponseSchema(1),
          };
          let response;
          if (config.apiFormat === 'cloudflare-workers-ai') {
            response = await reviewWithCloudflare(p.aiBinding, config.modelName, input, undefined, config.providerName);
          } else {
            if (!config.encryptedApiKey) {
              throw { isMissingKeyError: true, message: `Provider ${config.providerName} does not have a saved API key.` };
            }
            const apiKey = await decryptLlmApiKey(getSecretStore(p), config.encryptedApiKey);
            
            switch (config.apiFormat) {
              case 'gemini':
                response = await reviewWithGoogle({ apiKey, baseUrl: config.baseUrl, providerName: config.providerName, timeoutMs: 15000 }, config.modelName, input);
                break;
              case 'vertex':
                response = await reviewWithVertex({ apiKey, baseUrl: config.baseUrl, providerName: config.providerName }, config.modelName, input);
                break;
              case 'openai':
                response = await reviewWithOpenAI({ apiKey, baseUrl: config.baseUrl || 'https://api.openai.com/v1', providerName: config.providerName }, config.modelName, input);
                break;
              case 'anthropic':
                response = await reviewWithAnthropic({ apiKey, baseUrl: config.baseUrl, providerName: config.providerName }, config.modelName, input);
                break;
              default:
                throw new Error(`Unsupported API format: ${config.apiFormat}`);
            }
          }
          return {
            ok: true,
            modelUsed: response.modelUsed,
            provider: response.provider,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            ...(response.degraded === 'schema-dropped'
              ? { degraded: response.degraded, warning: 'Connected, but this endpoint rejected the response grammar. Reviews will run without constrained decoding.' }
              : {}),
          };
        } catch (error) {
          if (error instanceof ProviderRequestError) {
             throw { status: error.status >= 500 ? 502 : error.status, message: error.message, originalError: error };
          }
          throw error;
        }
      },
      createProviderWithSecret: async (input: any) => {
        let encryptedApiKey: string | null;
        try {
          encryptedApiKey = input.apiFormat === 'cloudflare-workers-ai'
            ? null
            : (input.apiKey ? await encryptLlmApiKey(getSecretStore(p), input.apiKey.trim()) : null);
        } catch (error) {
          if (error instanceof Error && error.message.includes('LLM_CONFIG_ENCRYPTION_KEY')) {
            throw { isEncryptionConfigError: true, message: error.message };
          }
          throw error;
        }

        if (input.enabled && input.apiFormat !== 'cloudflare-workers-ai' && !encryptedApiKey) {
          throw { isKeyRequiredError: true };
        }

        try {
          return await createLlmProvider(p.db, {
            name: input.name,
            apiFormat: input.apiFormat,
            baseUrl: input.apiFormat === 'cloudflare-workers-ai' ? null : (input.baseUrl ? input.baseUrl.replace(/\/+$/, '') : null), // basic normalization
            encryptedApiKey,
            enabled: input.enabled,
          });
        } catch (error: any) {
          if (error?.code === '23505') throw { isUniqueNameError: true };
          throw error;
        }
      },
      updateProviderWithSecret: async (id: string, input: any) => {
        const existing = await getLlmProvider(p.db, id);
        if (!existing) return null;

        let encryptedApiKey: string | null | undefined;
        try {
if (input.apiFormat === 'cloudflare-workers-ai') {
                    encryptedApiKey = null;
                } else if (input.clearApiKey) {
                    encryptedApiKey = null;
                } else if (input.apiKey) {
                    encryptedApiKey = await encryptLlmApiKey(getSecretStore(p), input.apiKey.trim());
                } else {
                    encryptedApiKey = undefined;
                }
        } catch (error) {
          if (error instanceof Error && error.message.includes('LLM_CONFIG_ENCRYPTION_KEY')) {
            throw { isEncryptionConfigError: true, message: error.message };
          }
          throw error;
        }

        const effectiveEncryptedApiKey = encryptedApiKey !== undefined ? encryptedApiKey : existing.encryptedApiKey;
        if (input.enabled && input.apiFormat !== 'cloudflare-workers-ai' && !effectiveEncryptedApiKey) {
          throw { isKeyRequiredError: true };
        }

        try {
          return await updateLlmProvider(p.db, id, {
            name: input.name,
            apiFormat: input.apiFormat,
            baseUrl: input.apiFormat === 'cloudflare-workers-ai' ? null : (input.baseUrl ? input.baseUrl.replace(/\/+$/, '') : null),
            ...(encryptedApiKey !== undefined ? { encryptedApiKey } : {}),
            enabled: input.enabled,
          });
        } catch (error: any) {
          if (error?.code === '23505') throw { isUniqueNameError: true };
          throw error;
        }
      },
    },
    sessionStore: p.sessionStore,
    platform: {
      scheduleBestEffortJobMaintenance: p.scheduleBestEffortJobMaintenance,
      createReviewRuntime: p.createReviewRuntime,
      getUpdatesEmailPreference: async (githubUserId: number) => await getUpdatesEmailPreference(p.kv, githubUserId),
      syncUpdatesEmail: async (githubUserId: number, email: string | null | undefined) => await syncUpdatesEmail(p.kv, githubUserId, email),
      terminateJobWorkflow: p.terminateJobWorkflow,
      enqueueReviewJob: p.enqueueReviewJob,
      getOrFetchRawDiffForCompletedJob: p.getOrFetchRawDiffForCompletedJob,
      logger: p.logger,
    },
    authProvider: {
      createOAuthState: async () => await createOAuthState(p.kv),
      consumeOAuthState: async (state: string) => await consumeOAuthState(p.kv, state),
      beginAuthorization: async (callbackUrl: string, state: string) =>
        await identityProvider(p).beginAuthorization(callbackUrl, state, toAppBindingsConfig(p) as any),
      completeAuthorization: async (code: string, state: string, expectedState: string) =>
        await identityProvider(p).completeAuthorization(code, state, expectedState, toAppBindingsConfig(p) as any),
    },
    webhook: {
      verifySignature: async (signature: string | null, body: string) => await verifyGitHubWebhookSignature(p.githubAppWebhookSecret, signature, body),
      normalizePayload: (eventName: string, payload: any) => normalizeGitHubWebhook(eventName, payload),
      extractReviewRequest: (input: any) => extractReviewRequest(input),
    },
  };
}








