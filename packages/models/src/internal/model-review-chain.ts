import { logger } from '@codraoss/core/logger';
import { isSubrequestBudgetMessage, isTimeoutMessage } from '@codraoss/schema/transient-errors';
import type { RepoConfig, ResolvedModelConfig  } from '@codraoss/schema';
import type { CloudflareAiBinding } from '../providers/cloudflare';
import { partialResponseOf, type ModelResponseSchema } from '../types';
import { chainAttemptTimeoutMs, clampTimeoutToChainBudget, MODEL_MIN_VIABLE_ATTEMPT_MS, MODEL_FALLBACK_CHAIN_BUDGET_MS, SUBREQUEST_HEADROOM_FOR_MODEL_CALL } from '../limits';
import {
  estimatePromptTokens,
  isCloudflareAllocationError,
  isGoogleRateLimitError,
  isTransientModelFailure,
  RetryableModelError,
} from './model-support';
import type { ModelChainContext } from './model-chain-runner';
import type { ModelRateLimitBook } from './model-rate-limits';
import type { ModelChainProgressStore } from './model-chain-progress';

const MAX_QUOTA_FAILURES_PER_FILE = 2;

export type ModelReviewContext = ModelChainContext & {
  aiBinding?: CloudflareAiBinding;
  rateLimits: ModelRateLimitBook;
  asyncUnsupportedModels: Set<string>;
  chainProgress: ModelChainProgressStore;
};

export async function runModelChain<T>(ctx: ModelReviewContext, params: {
  systemPrompt: string;
  userPrompt: string;
  responseSchema: ModelResponseSchema;
  timeoutMs: number;
  label: string;
  totalLineCount: number;
  config: RepoConfig;
  outputBudgetTokens?: number;
  truncationIntolerant?: boolean;
  // isLastModel: lets parsers reject weak answers except as a last resort.
  parse: (rawText: string, ctx: { isLastModel: boolean }) => T;
  // Bins pass member paths so progress survives mid-batch success/de-escalation.
  progressLabels?: readonly string[];
}) {
  const { systemPrompt, userPrompt, responseSchema, label, outputBudgetTokens, truncationIntolerant } = params;
  const progressLabels = params.progressLabels?.length ? params.progressLabels : [label];

  const { primary, fallbacks } = ctx.selectModel({
    totalLineCount: params.totalLineCount,
    config: params.config,
  });
  const wholeChain = [primary, ...fallbacks];

// Resume index is min across bin members, clamped to prevent emptying chain.
const recorded = await Promise.all(progressLabels.map((key) => ctx.chainProgress.startIndexFor(key)));
  const startIndex = Math.min(Math.min(...recorded), Math.max(wholeChain.length - 1, 0));
  const modelsToTry = wholeChain.slice(startIndex);
  if (startIndex > 0) {
    logger.info(`Resuming the model chain for ${label} at ${modelsToTry[0]}`, {
      startIndex,
      skipped: wholeChain.slice(0, startIndex),
    });
  }

  const timeoutMs = clampTimeoutToChainBudget(params.timeoutMs);

  const estimatedPromptTokens = estimatePromptTokens(systemPrompt, userPrompt);

  let lastError: unknown;
  let lastTransientError: unknown;
  let sawTransientFailure = false;
  let quotaFailures = 0;
  let attemptedAnyModel = false;
  let skippedForTimeouts = false;
  let attemptedFailedThrough = 0;
  const chainStartedAt = Date.now();
  let gateWaitMs = 0;
  const recordGateWait = (waitedMs: number) => { gateWaitMs += waitedMs; };
  for (const [modelIndex, currentModel] of modelsToTry.entries()) {
    // Subrequest cap: primary always runs, fallbacks defer once near the limit.
    if (modelIndex > 0 && ctx.tracker?.isNearLimit()) {
      logger.warn(`Skipping remaining fallback models for ${label}; subrequest budget for this invocation is nearly exhausted`, {
        skippedModels: modelsToTry.slice(modelIndex),
      });

      // Avoid the word 'subrequest' here so the message isn't misread as a runtime refusal.
      if (sawTransientFailure) {
        lastTransientError = lastTransientError ?? lastError ?? new Error('Per-invocation request budget was nearly exhausted before trying all configured fallback models');
      }
      break;
    }

    const attemptTimeoutMs = chainAttemptTimeoutMs({
      requestedMs: timeoutMs,
      remainingChainMs: MODEL_FALLBACK_CHAIN_BUDGET_MS - (Date.now() - chainStartedAt - gateWaitMs),
      hasAnotherModel: modelIndex < modelsToTry.length - 1,
    });

    if (modelIndex > 0 && attemptTimeoutMs === 0) {
      logger.warn(`Deferring ${label}: no room in the per-invocation time budget for another model`, {
        elapsedMs: Date.now() - chainStartedAt,
        gateWaitMs,
        timeoutMs,
        skippedModels: modelsToTry.slice(modelIndex),
      });
      sawTransientFailure = true;
      lastTransientError = lastTransientError ?? lastError ?? new Error(`Model fallback chain for ${label} exceeded its time budget; deferring for retry.`);
      break;
    }

    let resolved: ResolvedModelConfig;
    try {
      resolved = await ctx.resolveModel(currentModel);
    } catch (error) {
      lastError = error;
      logger.warn(`Model ${currentModel} could not be resolved`, {
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (resolved.apiFormat === 'cloudflare-workers-ai' && await ctx.isProviderUnavailable(resolved.providerId)) {
      logger.warn(`Skipping ${resolved.providerName} model ${currentModel} because the provider is unavailable for job ${ctx.jobId ?? 'unknown'}`);
      continue;
    }

    const isLastCandidate = modelIndex === modelsToTry.length - 1;
    const timingOut = isLastCandidate
      ? await ctx.chainProgress.isTimingOutTerminally(currentModel)
      : await ctx.chainProgress.isTimingOut(currentModel);
    if (timingOut) {
      skippedForTimeouts = true;
      logger.info(`Skipping ${currentModel} for ${label}: it has repeatedly timed out on this job`, {
        isLastCandidate,
      });
      continue;
    }

// Floor applies even to primary model, not just fallbacks.
if (ctx.tracker && !ctx.tracker.hasRemainingSubrequests(SUBREQUEST_HEADROOM_FOR_MODEL_CALL)) {
      logger.warn(`Deferring ${label}: not enough subrequest budget left to commit a prompt`, {
        subrequests: ctx.tracker.getSubrequestCount(),
        needed: SUBREQUEST_HEADROOM_FOR_MODEL_CALL,
        skippedModels: modelsToTry.slice(modelIndex),
      });
      sawTransientFailure = true;
      lastTransientError = lastTransientError ?? lastError
        ?? new Error(`Per-invocation request budget was too low to attempt a model for ${label}; deferring for retry.`);
      break;
    }

    const skipReason = await ctx.rateLimits.skipReason(resolved.modelName, estimatedPromptTokens);
    if (skipReason) {
      logger.info(`Skipping ${currentModel} for ${label}: ${skipReason}`);
      ctx.tracker?.recordSkippedCall(resolved.modelName, skipReason);
      continue;
    }

    try {
      attemptedAnyModel = true;
      const response = await ctx.callResolvedModel(
        resolved,
        { systemPrompt, userPrompt, responseSchema, outputBudgetTokens, truncationIntolerant },
        Math.max(attemptTimeoutMs, MODEL_MIN_VIABLE_ATTEMPT_MS),
        recordGateWait,
      );

      if (ctx.tracker) {
        ctx.tracker.record(response.modelUsed, response.inputTokens, response.outputTokens);
      }

// `isLastModel` uses the absolute chain index for resumed jobs.
const parsed = params.parse(response.rawText, {
        isLastModel: startIndex + modelIndex >= wholeChain.length - 1,
      });
      await ctx.chainProgress.noteSuccess(currentModel);
      await Promise.all(progressLabels.map((key) => ctx.chainProgress.clear(key)));
      await ctx.chainProgress.flushPending();
      return { ...response, userPrompt, parsed };
    } catch (error) {
      const isLastModel = startIndex + modelIndex >= wholeChain.length - 1;
// Salvage truncated partials from the final model.
const partial = isLastModel ? partialResponseOf(error) : null;
      if (partial) {
        try {
          const parsed = params.parse(partial.rawText, { isLastModel: true });
          logger.warn(`Salvaged a truncated response from the last model in the chain for ${label}`, {
            model: partial.modelUsed,
            responseChars: partial.rawText.length,
          });
          if (ctx.tracker) {
            ctx.tracker.record(partial.modelUsed, partial.inputTokens, partial.outputTokens);
          }
          await Promise.all(progressLabels.map((key) => ctx.chainProgress.clear(key)));
          await ctx.chainProgress.flushPending();
          return { ...partial, userPrompt, parsed, degraded: 'truncated' as const };
        } catch {
          // intentional no-op
        }
      }

      lastError = error;
      ctx.tracker?.recordFailedAttempt(
        resolved.modelName,
        estimatedPromptTokens,
        isGoogleRateLimitError(error) ? 'rate-limited' : 'error',
      );
      if (isTransientModelFailure(error)) {
        sawTransientFailure = true;
        lastTransientError = error;
      }
      if (resolved.apiFormat === 'cloudflare-workers-ai' && isCloudflareAllocationError(error)) {
        await ctx.markProviderUnavailable(resolved.providerId, error instanceof Error ? error.message : String(error));
      }

      // Out of subrequests: abort now (not recorded as progress, so healthy models aren't skipped on retry).
      if (isSubrequestBudgetMessage(error)) {
        logger.warn(`Aborting the model chain for ${label}; this invocation is out of subrequests`, {
          skippedModels: modelsToTry.slice(modelIndex + 1),
        });
        sawTransientFailure = true;
        lastTransientError = error;
        break;
      }

      if (isTimeoutMessage(String(error instanceof Error ? error.message : error).toLowerCase())) {
        await ctx.chainProgress.noteTimeout(currentModel);
      }

      const rateLimited = isGoogleRateLimitError(error);
      if (!rateLimited) attemptedFailedThrough = startIndex + modelIndex + 1;
      if (rateLimited) {
        quotaFailures += 1;
        ctx.rateLimits.note(resolved, error);
      }

      const outOfQuotaBudget = quotaFailures >= MAX_QUOTA_FAILURES_PER_FILE;

      logger.warn(`Model ${currentModel} failed for ${label}`, {
        error: error instanceof Error ? error.message : String(error),
        rateLimited,
        quotaFailures,
        // Named "Input" not "Tokens": the logger redacts fields containing "token".
        estimatedWastedInput: estimatedPromptTokens,
        willTryFallback: !outOfQuotaBudget && modelIndex < modelsToTry.length - 1,
      });

      if (outOfQuotaBudget) {
        sawTransientFailure = true;
        lastTransientError = error;
        break;
      }
    }
  }

  if (sawTransientFailure) {
    const retryCause = lastTransientError ?? lastError;
    const lastMessage = retryCause instanceof Error ? retryCause.message : String(retryCause ?? 'Unknown model error');
    const error = new RetryableModelError(
      `All configured review models failed for ${label}; retrying later. Last error: ${lastMessage}`,
      retryCause,
    );

// Skipped at chain end, so a fresh retry starts clean.
if (attemptedFailedThrough > 0 && attemptedFailedThrough < wholeChain.length) {
      await Promise.all(progressLabels.map((key) => ctx.chainProgress.advance(key, attemptedFailedThrough)));
      Object.defineProperty(error, 'nextChainIndex', { value: attemptedFailedThrough, configurable: true });
    } else {
      await ctx.chainProgress.flushPending();
    }
    throw error;
  }

  if (!attemptedAnyModel) {
// Unwrap permanent operator error.
if (lastError !== undefined) {
      if (isTransientModelFailure(lastError)) {
        throw new RetryableModelError(`Every model for ${label} failed to resolve; retrying later.`, lastError);
      }
      throw lastError;
    }

    throw new RetryableModelError(
      `No configured review model was attempted for ${label} (all skipped: ${
        skippedForTimeouts ? 'repeated timeouts on this job' : 'rate-limit cooldown or provider unavailable'
      }); retrying later.`,
    );
  }

  throw lastError;
}
