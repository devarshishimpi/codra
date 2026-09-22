import { buildSummaryPrompt, SUMMARY_SYSTEM_PROMPT } from '@codraoss/core/prompts/summary';
import { buildVerifyPrompt, VERIFY_RESPONSE_SCHEMA, VERIFY_SYSTEM_PROMPT, type VerifyCandidate } from '@codraoss/core/prompts/verify';
import {
  adaptiveModelTimeoutMs,
  chainAttemptTimeoutMs,
  clampTimeoutToChainBudget,
  MODEL_FALLBACK_CHAIN_BUDGET_MS,
  MODEL_MIN_VIABLE_ATTEMPT_MS,
  verifyTimeoutMs,
} from '../limits';
import { isCloudflareAllocationError, isTransientModelFailure, RetryableModelError } from './model-support';
import { logger } from '@codraoss/core/logger';
import type { RepoConfig, ResolvedModelConfig  } from '@codraoss/schema';
import type { TokenTracker } from '@codraoss/core/token-tracker';
import type { ModelInput, ModelResponse } from '../types';

// Import from services/model.ts, not here -- four specs vi.mock that specifier.

// `ModelChainContext` kept private as an implementation detail.
export type ModelChainContext = {
  selectModel(params: { totalLineCount: number; config: RepoConfig }): { primary: string; fallbacks: string[] };
  resolveModel(model: string): Promise<ResolvedModelConfig>;
  isProviderUnavailable(providerId: string): Promise<boolean>;
  markProviderUnavailable(providerId: string, reason: string): Promise<void>;
  callResolvedModel(
    resolved: ResolvedModelConfig,
    input: ModelInput,
    timeoutMs?: number,
    onGateWait?: (waitedMs: number) => void,
  ): Promise<ModelResponse>;
  tracker?: TokenTracker;
  jobId?: string;
};

export async function generateSummary(ctx: ModelChainContext, params: {
  prTitle: string | null;
  verdict: 'approve' | 'comment';
  fileSummaries: Array<{ path: string; summary: string; verdict: string }>;
  config: RepoConfig;
}) {
  const { primary, fallbacks } = ctx.selectModel({ totalLineCount: 0, config: params.config });
  const modelsToTry = [primary, ...fallbacks];

  let lastError: unknown;
  let lastTransientError: unknown;
  let sawTransientFailure = false;
  for (const currentModel of modelsToTry) {
    let resolved: ResolvedModelConfig;
    try {
      resolved = await ctx.resolveModel(currentModel);
    } catch (error) {
      lastError = error;
      logger.warn(`Summary model ${currentModel} could not be resolved`, {
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (resolved.apiFormat === 'cloudflare-workers-ai' && await ctx.isProviderUnavailable(resolved.providerId)) {
      logger.warn(`Skipping ${resolved.providerName} summary model ${currentModel} because the provider is unavailable for job ${ctx.jobId ?? 'unknown'}`);
      continue;
    }

    try {
      const response = await ctx.callResolvedModel(resolved, {
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        userPrompt: buildSummaryPrompt(params),
      }, adaptiveModelTimeoutMs(0));

      if (ctx.tracker) {
        ctx.tracker.record(response.modelUsed, response.inputTokens, response.outputTokens);
      }

      return response;
    } catch (error) {
      lastError = error;
      if (isTransientModelFailure(error)) {
        sawTransientFailure = true;
        lastTransientError = error;
      }
      if (resolved.apiFormat === 'cloudflare-workers-ai' && isCloudflareAllocationError(error)) {
        await ctx.markProviderUnavailable(resolved.providerId, error instanceof Error ? error.message : String(error));
      }
      logger.warn(`Summary model ${currentModel} failed`, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (sawTransientFailure) {
    const retryCause = lastTransientError ?? lastError;
    const lastMessage = retryCause instanceof Error ? retryCause.message : String(retryCause ?? 'Unknown model error');
    throw new RetryableModelError(
      `All configured summary models failed; retrying later. Last error: ${lastMessage}`,
      retryCause,
    );
  }

  throw lastError;
}

// Best-effort: failures retain pre-verification findings.
export async function verifyFindings(ctx: ModelChainContext, params: { candidates: VerifyCandidate[]; config: RepoConfig }): Promise<ModelResponse> {
  const { primary, fallbacks } = ctx.selectModel({ totalLineCount: 0, config: params.config });
  const modelsToTry = [primary, ...fallbacks];
  const input: ModelInput = {
    systemPrompt: VERIFY_SYSTEM_PROMPT,
    userPrompt: buildVerifyPrompt(params.candidates),
    // Must use verify grammar, not file-review.
    responseSchema: VERIFY_RESPONSE_SCHEMA as unknown as ModelInput['responseSchema'],
    // Truncated list silently withholds findings.
    truncationIntolerant: true,
  };
  const requestedTimeoutMs = clampTimeoutToChainBudget(verifyTimeoutMs(params.candidates.length));

  let lastError: unknown;
  const chainStartedAt = Date.now();
  let gateWaitMs = 0;
  const recordGateWait = (waitedMs: number) => { gateWaitMs += waitedMs; };

  for (const [modelIndex, currentModel] of modelsToTry.entries()) {
    // Finalize can't hibernate; prevent full-chain budget burn.
    if (modelIndex > 0 && ctx.tracker?.isNearLimit()) {
      logger.warn('Stopping the verification chain; subrequest budget for this invocation is nearly exhausted', {
        skippedModels: modelsToTry.slice(modelIndex),
      });
      break;
    }
    const attemptTimeoutMs = chainAttemptTimeoutMs({
      requestedMs: requestedTimeoutMs,
      remainingChainMs: MODEL_FALLBACK_CHAIN_BUDGET_MS - (Date.now() - chainStartedAt - gateWaitMs),
      hasAnotherModel: modelIndex < modelsToTry.length - 1,
    });

    if (modelIndex > 0 && attemptTimeoutMs === 0) {
      logger.warn('Stopping the verification chain; no room in the per-invocation time budget for another model', {
        elapsedMs: Date.now() - chainStartedAt,
        gateWaitMs,
        requestedTimeoutMs,
        skippedModels: modelsToTry.slice(modelIndex),
      });
      break;
    }

    let resolved: ResolvedModelConfig;
    try {
      resolved = await ctx.resolveModel(currentModel);
    } catch (error) {
      lastError = error;
      continue;
    }

    if (resolved.apiFormat === 'cloudflare-workers-ai' && await ctx.isProviderUnavailable(resolved.providerId)) {
      continue;
    }

    try {
      const response = await ctx.callResolvedModel(
        resolved,
        input,
        Math.max(attemptTimeoutMs, MODEL_MIN_VIABLE_ATTEMPT_MS),
        recordGateWait,
      );
      if (ctx.tracker) {
        ctx.tracker.record(response.modelUsed, response.inputTokens, response.outputTokens);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (resolved.apiFormat === 'cloudflare-workers-ai' && isCloudflareAllocationError(error)) {
        await ctx.markProviderUnavailable(resolved.providerId, error instanceof Error ? error.message : String(error));
      }
      logger.warn(`Verification model ${currentModel} failed`, {
        error: error instanceof Error ? error.message : String(error),
        attemptTimeoutMs,
        candidates: params.candidates.length,
      });
    }
  }

  throw lastError ?? new Error('No model available for verification pass.');
}
