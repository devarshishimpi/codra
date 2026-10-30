import type { PlatformDeps } from "./create-deps";
import type { ModelRunnerPort } from "./ports";
import {
  listLlmProviderSecrets,
  upsertDiscoveredModelConfigs,
  createLlmProvider,
  updateLlmProvider,
  getResolvedModelConfig,
  getLlmProvider,
} from "@codraoss/db/model-configs";
import {
  encryptLlmApiKey,
  decryptLlmApiKey,
  listProviderModels,
  reviewWithCloudflare,
  reviewWithGoogle,
  reviewWithVertex,
  reviewWithOpenAI,
  reviewWithAnthropic,
  ProviderRequestError,
} from "@codraoss/models";
import { buildReviewResponseSchema } from "@codraoss/core/prompts/file-review";

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

export function createModelRunnerDeps(p: PlatformDeps): ModelRunnerPort {
  return {
    syncProviderModelCatalog: async () => {
      const providers = await listLlmProviderSecrets(p.db);
      const syncErrors: Array<{
        providerId: string;
        providerName: string;
        error: string;
      }> = [];

      await Promise.all(
        providers.map(async (provider) => {
          if (!provider.enabled) return;
          if (
            provider.apiFormat === "cloudflare-workers-ai" &&
            p.cloudflareAiEnabled === false
          )
            return;
          if (
            provider.apiFormat !== "cloudflare-workers-ai" &&
            !provider.encryptedApiKey
          )
            return;

          try {
            const apiKey = provider.encryptedApiKey
              ? await decryptLlmApiKey(
                  getSecretStore(p),
                  provider.encryptedApiKey,
                )
              : undefined;
            const modelNames = await listProviderModels({
              apiFormat: provider.apiFormat,
              baseUrl: provider.baseUrl,
              apiKey,
              cloudflareAccountId: optionalEnv(() => p.cfAccountId || ""),
              cloudflareApiToken: optionalEnv(() => p.cfApiToken || ""),
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
              error:
                error instanceof Error
                  ? error.message
                  : "Could not refresh provider models.",
            });
          }
        }),
      );

      return syncErrors;
    },
    testConnection: async (modelId: string) => {
      const config = await getResolvedModelConfig(p.db, modelId);
      if (!config) throw { isNotFoundError: true };
      if (!config.providerEnabled)
        throw { isDisabledError: true, message: "Provider is disabled." };
      if (
        config.apiFormat === "cloudflare-workers-ai" &&
        p.cloudflareAiEnabled === false
      ) {
        throw {
          isUnsupportedError: true,
          message: "Cloudflare Workers AI is unavailable in the Node.js runtime.",
        };
      }

      try {
        const input = {
          systemPrompt:
            "You are validating connectivity. Return only the JSON object.",
          userPrompt:
            'Return an empty review: no findings, overall_correctness "patch is correct".',
          responseSchema: buildReviewResponseSchema(1),
        };
        let response;
        if (config.apiFormat === "cloudflare-workers-ai") {
          response = await reviewWithCloudflare(
            p.aiBinding,
            config.modelName,
            input,
            undefined,
            config.providerName,
          );
        } else {
          if (!config.encryptedApiKey) {
            throw {
              isMissingKeyError: true,
              message: `Provider ${config.providerName} does not have a saved API key.`,
            };
          }
          const apiKey = await decryptLlmApiKey(
            getSecretStore(p),
            config.encryptedApiKey,
          );

          switch (config.apiFormat) {
            case "gemini":
              response = await reviewWithGoogle(
                {
                  apiKey,
                  baseUrl: config.baseUrl,
                  providerName: config.providerName,
                  timeoutMs: 15000,
                },
                config.modelName,
                input,
              );
              break;
            case "vertex":
              response = await reviewWithVertex(
                {
                  apiKey,
                  baseUrl: config.baseUrl,
                  providerName: config.providerName,
                },
                config.modelName,
                input,
              );
              break;
            case "openai":
              response = await reviewWithOpenAI(
                {
                  apiKey,
                  baseUrl: config.baseUrl || "https://api.openai.com/v1",
                  providerName: config.providerName,
                },
                config.modelName,
                input,
              );
              break;
            case "anthropic":
              response = await reviewWithAnthropic(
                {
                  apiKey,
                  baseUrl: config.baseUrl,
                  providerName: config.providerName,
                },
                config.modelName,
                input,
              );
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
          ...(response.degraded === "schema-dropped"
            ? {
                degraded: response.degraded,
                warning:
                  "Connected, but this endpoint rejected the response grammar. Reviews will run without constrained decoding.",
              }
            : {}),
        };
      } catch (error) {
        if (error instanceof ProviderRequestError) {
          throw {
            status: error.status >= 500 ? 502 : error.status,
            message: error.message,
            originalError: error,
          };
        }
        throw error;
      }
    },
    createProviderWithSecret: async (input: any) => {
      let encryptedApiKey: string | null;
      try {
        encryptedApiKey =
          input.apiFormat === "cloudflare-workers-ai"
            ? null
            : input.apiKey
              ? await encryptLlmApiKey(getSecretStore(p), input.apiKey.trim())
              : null;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("LLM_CONFIG_ENCRYPTION_KEY")
        ) {
          throw { isEncryptionConfigError: true, message: error.message };
        }
        throw error;
      }

      if (
        input.enabled &&
        input.apiFormat !== "cloudflare-workers-ai" &&
        !encryptedApiKey
      ) {
        throw { isKeyRequiredError: true };
      }

      try {
        return await createLlmProvider(p.db, {
          name: input.name,
          apiFormat: input.apiFormat,
          baseUrl:
            input.apiFormat === "cloudflare-workers-ai"
              ? null
              : input.baseUrl
                ? input.baseUrl.replace(/\/+$/, "")
                : null, // basic normalization
          encryptedApiKey,
          enabled: input.enabled,
        });
      } catch (error: any) {
        if (error?.code === "23505") throw { isUniqueNameError: true };
        throw error;
      }
    },
    updateProviderWithSecret: async (id: string, input: any) => {
      const existing = await getLlmProvider(p.db, id);
      if (!existing) return null;

      let encryptedApiKey: string | null | undefined;
      try {
        if (input.apiFormat === "cloudflare-workers-ai") {
          encryptedApiKey = null;
        } else if (input.clearApiKey) {
          encryptedApiKey = null;
        } else if (input.apiKey) {
          encryptedApiKey = await encryptLlmApiKey(
            getSecretStore(p),
            input.apiKey.trim(),
          );
        } else {
          encryptedApiKey = undefined;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("LLM_CONFIG_ENCRYPTION_KEY")
        ) {
          throw { isEncryptionConfigError: true, message: error.message };
        }
        throw error;
      }

      const effectiveEncryptedApiKey =
        encryptedApiKey !== undefined
          ? encryptedApiKey
          : existing.encryptedApiKey;
      if (
        input.enabled &&
        input.apiFormat !== "cloudflare-workers-ai" &&
        !effectiveEncryptedApiKey
      ) {
        throw { isKeyRequiredError: true };
      }

      try {
        return await updateLlmProvider(p.db, id, {
          name: input.name,
          apiFormat: input.apiFormat,
          baseUrl:
            input.apiFormat === "cloudflare-workers-ai"
              ? null
              : input.baseUrl
                ? input.baseUrl.replace(/\/+$/, "")
                : null,
          ...(encryptedApiKey !== undefined ? { encryptedApiKey } : {}),
          enabled: input.enabled,
        });
      } catch (error: any) {
        if (error?.code === "23505") throw { isUniqueNameError: true };
        throw error;
      }
    },
  };
}
