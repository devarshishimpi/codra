import type { KvStore, SecretStore } from "@codraoss/core/ports";
import type { CloudflareAiBinding } from "./providers/cloudflare";
import { reviewWithGoogle } from "./providers/google";
import { reviewWithVertex } from "./providers/vertex";
import { reviewWithCloudflare } from "./providers/cloudflare";
import { reviewWithOpenAI } from "./providers/openai";
import { reviewWithAnthropic } from "./providers/anthropic";
import type { VerifyCandidate } from "@codraoss/core/prompts/verify";
import type { RepoConfig, ResolvedModelConfig } from "@codraoss/schema";
import type { TokenTracker } from "@codraoss/core/token-tracker";
import type { ModelInput, ModelResponse } from "./types";
import { logger } from "@codraoss/core/logger";
import { decryptLlmApiKey } from "./llm-crypto";
import {
  isSchemaDroppedError,
  normalizeModel,
  uniqueModels,
} from "./internal/model-support";
import { ModelRateLimitBook } from "./internal/model-rate-limits";
import { ModelChainProgressStore } from "./internal/model-chain-progress";
import {
  type ModelChainContext,
  generateSummary,
  verifyFindings,
} from "./internal/model-chain-runner";
import {
  type ModelReviewContext,
  reviewFile,
  reviewFiles,
} from "./internal/model-review-file";
export type { BatchReviewOutcome } from "./internal/model-review-file";
import {
  pollReviewBatch,
  submitReviewBatch,
} from "./internal/model-review-batch";

export {
  RetryableModelError,
  isRetryableModelError,
  nextChainIndexOf,
} from "./internal/model-support";
export {
  PROMPT_FIT_SAFETY_FACTOR,
  estimatePromptTokens,
} from "./internal/model-support";
export { ModelChainProgressStore } from "./internal/model-chain-progress";
export {
  isPlausibleTokenBucket,
  parseRateLimitFromError,
} from "./internal/model-support";

const PROVIDER_UNAVAILABLE_TTL_SECONDS = 24 * 60 * 60;
export class ModelRunner {
  // Caches in-flight config requests.
  private readonly resolvedModelCache = new Map<
    string,
    Promise<ResolvedModelConfig | null>
  >();

  // Backed by chainProgress to persist across invocations.
  private readonly rateLimits: ModelRateLimitBook;

  // Cached per instance.
  private readonly providerUnavailableCache = new Map<
    string,
    Promise<boolean>
  >();

  private readonly asyncUnsupportedModels = new Set<string>();
  private readonly schemaUnsupportedModels = new Set<string>();

  // Per-file progress to resume defers.
  private readonly chainProgress: ModelChainProgressStore;

  constructor(
    private deps: {
      kv: KvStore;
      secretStore: SecretStore;
      getConfig: (modelId: string) => Promise<ResolvedModelConfig | null>;
      aiBinding?: CloudflareAiBinding;
      tracker?: TokenTracker;
      jobId?: string;
    },
  ) {
    this.chainProgress = new ModelChainProgressStore(
      deps.kv,
      deps.jobId,
      deps.tracker,
    );
    this.rateLimits = new ModelRateLimitBook(this.chainProgress);
  }

  private providerUnavailableKey(providerId: string) {
    return this.deps.jobId
      ? `jobs:${this.deps.jobId}:provider-unavailable:${providerId}`
      : null;
  }

  private isProviderUnavailable(providerId: string): Promise<boolean> {
    const key = this.providerUnavailableKey(providerId);
    if (!key) return Promise.resolve(false);

    let pending = this.providerUnavailableCache.get(providerId);
    if (!pending) {
      pending = (async () => {
        try {
          this.deps.tracker?.incrementSubrequests(1);
          return (await this.deps.kv.get(key)) !== null;
        } catch (error) {
          logger.warn(
            `Failed to read unavailable provider marker for ${providerId}`,
            {
              error: error instanceof Error ? error.message : String(error),
            },
          );
          return false;
        }
      })();
      this.providerUnavailableCache.set(providerId, pending);
    }
    return pending;
  }

  private async markProviderUnavailable(providerId: string, reason: string) {
    const key = this.providerUnavailableKey(providerId);
    if (!key) return;

    this.providerUnavailableCache.set(providerId, Promise.resolve(true));

    try {
      this.deps.tracker?.incrementSubrequests(1);
      await this.deps.kv.put(
        key,
        JSON.stringify({
          reason,
          markedAt: new Date().toISOString(),
        }),
        { expirationTtl: PROVIDER_UNAVAILABLE_TTL_SECONDS },
      );
    } catch (error) {
      logger.warn(
        `Failed to write unavailable provider marker for ${providerId}`,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private selectModel(params: { totalLineCount: number; config: RepoConfig }): {
    primary: string;
    fallbacks: string[];
  } {
    const { model: modelCfg } = params.config;
    const thresholdBase = params.totalLineCount;

    let selectedModel = modelCfg?.main ? normalizeModel(modelCfg.main) : null;
    let fallbackModels = (modelCfg?.fallbacks || []).map(normalizeModel);

    if (modelCfg?.size_overrides && modelCfg.size_overrides.length > 0) {
      const sortedOverrides = modelCfg.size_overrides.toSorted(
        (a, b) => a.max_lines - b.max_lines,
      );
      const matched = sortedOverrides.find((o) => thresholdBase <= o.max_lines);
      if (matched) {
        selectedModel = normalizeModel(matched.model);
        fallbackModels = (matched.fallbacks || fallbackModels).map(
          normalizeModel,
        );
      }
    }

    const chain = uniqueModels([
      ...(selectedModel ? [selectedModel] : []),
      ...fallbackModels,
    ]);
    if (chain.length === 0) {
      throw new Error(
        "No review model strategy is configured. Choose a global model strategy in Settings, or configure this repository.",
      );
    }

    selectedModel = chain[0];
    fallbackModels = chain.slice(1);

    return { primary: selectedModel, fallbacks: fallbackModels };
  }

  private async resolveModel(model: string) {
    const normalized = normalizeModel(model);
    let pending = this.resolvedModelCache.get(normalized);
    if (!pending) {
      // Cache null to prevent requery.
      pending = this.deps.getConfig(normalized);
      this.resolvedModelCache.set(normalized, pending);
      // Drop cache on error so next call retries.
      pending.catch(() => this.resolvedModelCache.delete(normalized));
    }
    const resolved = await pending;
    if (!resolved) {
      throw new Error(
        `Model ${normalized} is not configured. Add it in Settings before using it in a route.`,
      );
    }

    if (!resolved.providerEnabled) {
      throw new Error(`Provider ${resolved.providerName} is disabled.`);
    }

    return resolved;
  }

  private async decryptApiKey(config: ResolvedModelConfig) {
    if (!config.encryptedApiKey) {
      throw new Error(
        `Provider ${config.providerName} does not have a saved API key.`,
      );
    }
    return decryptLlmApiKey(this.deps.secretStore, config.encryptedApiKey);
  }

  private async callResolvedModel(
    config: ResolvedModelConfig,
    input: ModelInput,
    timeoutMs?: number,
    // Excludes queue wait from caller's budget.
    onGateWait?: (waitedMs: number) => void,
  ): Promise<ModelResponse> {
    // Resolve credentials before gate so slow work doesn't hold it.
    if (config.apiFormat === "cloudflare-workers-ai") {
      if (!this.deps.aiBinding) {
        throw new Error(
          `Provider ${config.providerName} requires a Cloudflare AI binding, but none was provided.`,
        );
      }
      return this.rateLimits.runGated(config, onGateWait, () =>
        reviewWithCloudflare(
          this.deps.aiBinding!,
          config.modelName,
          input,
          this.deps.tracker,
          config.providerName,
          { timeoutMs },
        ),
      );
    }

    if (config.apiFormat === "gemini") {
      const apiKey = await this.decryptApiKey(config);
      const schemaKey = `${config.providerId}|${config.modelName}|${input.responseSchema?.name ?? "none"}`;
      let response: ModelResponse;
      try {
        response = await this.rateLimits.runGated(config, onGateWait, () => {
          // Read inside gate to prevent race conditions.
          const gatedInput = this.schemaUnsupportedModels.has(schemaKey)
            ? { ...input, responseSchema: undefined }
            : input;
          return reviewWithGoogle(
            {
              apiKey,
              baseUrl: config.baseUrl,
              providerName: config.providerName,
              timeoutMs,
            },
            config.modelName,
            gatedInput,
            this.deps.tracker,
          );
        });
      } catch (error) {
        // Latch failure to avoid repeated 400s.
        if (isSchemaDroppedError(error))
          this.schemaUnsupportedModels.add(schemaKey);
        throw error;
      }
      if (
        response.degraded === "schema-dropped" ||
        response.degraded === "schema-dropped-catchall"
      ) {
        this.schemaUnsupportedModels.add(schemaKey);
      }
      return response;
    }

    if (config.apiFormat === "vertex") {
      const apiKey = await this.decryptApiKey(config);
      return this.rateLimits.runGated(config, onGateWait, () =>
        reviewWithVertex(
          {
            apiKey,
            baseUrl: config.baseUrl,
            providerName: config.providerName,
            timeoutMs,
          },
          config.modelName,
          input,
          this.deps.tracker,
        ),
      );
    }

    if (config.apiFormat === "openai") {
      const apiKey = await this.decryptApiKey(config);
      return this.rateLimits.runGated(config, onGateWait, () =>
        reviewWithOpenAI(
          {
            apiKey,
            baseUrl: config.baseUrl || "https://api.openai.com/v1",
            providerName: config.providerName,
            timeoutMs,
          },
          config.modelName,
          input,
          this.deps.tracker,
        ),
      );
    }

    const apiKey = await this.decryptApiKey(config);
    return this.rateLimits.runGated(config, onGateWait, () =>
      reviewWithAnthropic(
        {
          apiKey,
          baseUrl: config.baseUrl,
          providerName: config.providerName,
          timeoutMs,
        },
        config.modelName,
        input,
        this.deps.tracker,
      ),
    );
  }

  private async callModel(
    model: string,
    input: ModelInput,
    timeoutMs?: number,
  ): Promise<ModelResponse> {
    return this.callResolvedModel(
      await this.resolveModel(model),
      input,
      timeoutMs,
    );
  }

  private reviewCtx(): ModelReviewContext {
    return {
      ...this.chainCtx(),
      aiBinding: this.deps.aiBinding,
      rateLimits: this.rateLimits,
      asyncUnsupportedModels: this.asyncUnsupportedModels,
      chainProgress: this.chainProgress,
    };
  }

  async reviewFile(params: Parameters<typeof reviewFile>[1]) {
    return reviewFile(this.reviewCtx(), params);
  }

  // Do not record batch.missing files.
  async reviewFiles(params: Parameters<typeof reviewFiles>[1]) {
    return reviewFiles(this.reviewCtx(), params);
  }

  async submitReviewBatch(params: Parameters<typeof submitReviewBatch>[1]) {
    return submitReviewBatch(this.reviewCtx(), params);
  }

  async pollReviewBatch(params: Parameters<typeof pollReviewBatch>[1]) {
    return pollReviewBatch(this.reviewCtx(), params);
  }

  private chainCtx(): ModelChainContext {
    return {
      selectModel: (params) => this.selectModel(params),
      resolveModel: (model) => this.resolveModel(model),
      isProviderUnavailable: (providerId) =>
        this.isProviderUnavailable(providerId),
      markProviderUnavailable: (providerId, reason) =>
        this.markProviderUnavailable(providerId, reason),
      callResolvedModel: (resolved, input, timeoutMs, onGateWait) =>
        this.callResolvedModel(resolved, input, timeoutMs, onGateWait),
      tracker: this.deps.tracker,
      jobId: this.deps.jobId,
    };
  }

  async generateSummary(params: {
    prTitle: string | null;
    verdict: "approve" | "comment";
    fileSummaries: Array<{ path: string; summary: string; verdict: string }>;
    config: RepoConfig;
  }) {
    return generateSummary(this.chainCtx(), params);
  }

  async verifyFindings(params: {
    candidates: VerifyCandidate[];
    config: RepoConfig;
  }): Promise<ModelResponse> {
    return verifyFindings(this.chainCtx(), params);
  }
}
