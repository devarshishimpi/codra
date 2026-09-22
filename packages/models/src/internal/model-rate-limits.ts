import { logger } from '@codraoss/core/logger';
import { ModelCallGate } from '../limits';
import type { ResolvedModelConfig } from '@codraoss/schema';
import { MAX_METERED_QUEUE_DEPTH, PROMPT_FIT_SAFETY_FACTOR, parseRateLimitFromError } from './model-support';

export interface RateLimitPersistence {
  loadCooldowns(): Promise<Map<string, { cooldownUntil: number; limitTokens?: number }>>;
  noteRateLimit(modelId: string, entry: { cooldownUntil: number; limitTokens?: number }): void;
}

export class ModelRateLimitBook {
  // Slot held before client timeout starts.
  private readonly callGate = new ModelCallGate();

  private readonly modelRateLimits = new Map<string, { limitTokens?: number; cooldownUntil: number }>();

  // Keyed by model.
  private readonly tokenMeteredModels = new Map<string, ModelCallGate>();

  private hydrated: Promise<void> | null = null;

  constructor(private readonly persistence?: RateLimitPersistence) {}

  private hydrate(): Promise<void> {
    this.hydrated ??= (async () => {
      if (!this.persistence) return;
      for (const [modelName, entry] of await this.persistence.loadCooldowns()) {
        const existing = this.modelRateLimits.get(modelName);
        this.modelRateLimits.set(modelName, {
          limitTokens: existing?.limitTokens ?? entry.limitTokens,
          cooldownUntil: Math.max(existing?.cooldownUntil ?? 0, entry.cooldownUntil),
        });

        // Serialize from the first call, not after re-earning our own 429.
        if (!this.tokenMeteredModels.has(modelName)) {
          this.tokenMeteredModels.set(modelName, new ModelCallGate(1));
        }
      }
    })();
    return this.hydrated;
  }

  note(resolved: ResolvedModelConfig, error: unknown) {
    const { limitTokens, retryAfterMs } = parseRateLimitFromError(error);
    const existing = this.modelRateLimits.get(resolved.modelName);

    const entry = {
      limitTokens: limitTokens ?? existing?.limitTokens, // sticky: a later 429 without a number can't erase it
      cooldownUntil: Date.now() + (retryAfterMs ?? 60_000),
    };
    this.modelRateLimits.set(resolved.modelName, entry);
    this.persistence?.noteRateLimit(resolved.modelName, entry);

    if (!this.tokenMeteredModels.has(resolved.modelName)) {
      this.tokenMeteredModels.set(resolved.modelName, new ModelCallGate(1));
      logger.info(`Serializing calls to ${resolved.modelName}; it enforces a token-per-minute bucket`, {
        provider: resolved.providerName,
        limitTokens: limitTokens ?? null,
      });
    }
  }

  async skipReason(modelName: string, estimatedPromptTokens: number): Promise<string | null> {
    await this.hydrate();

    const gate = this.tokenMeteredModels.get(modelName);
    if (gate && gate.queueDepth >= MAX_METERED_QUEUE_DEPTH) {
      return `${gate.queueDepth} calls already queued on it`;
    }

    const known = this.modelRateLimits.get(modelName);
    if (!known) return null;

    if (known.cooldownUntil > Date.now()) {
      return `cooling off for another ${Math.ceil((known.cooldownUntil - Date.now()) / 1000)}s`;
    }

    if (known.limitTokens && estimatedPromptTokens > known.limitTokens * PROMPT_FIT_SAFETY_FACTOR) {
      return `prompt ~${estimatedPromptTokens} tokens exceeds its ${known.limitTokens}-token bucket`;
    }

    return null;
  }

  async runShared<T>(fn: () => Promise<T>): Promise<T> {
    return this.callGate.run(fn);
  }

  // Model gate before shared gate, in that order, to rule out deadlock.
  async runGated<T>(
    resolved: ResolvedModelConfig,
    onGateWait: ((waitedMs: number) => void) | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const modelGate = this.tokenMeteredModels.get(resolved.modelName);
    if (!modelGate) return this.callGate.run(fn, onGateWait);
    return modelGate.run(() => this.callGate.run(fn, onGateWait), onGateWait);
  }
}
