import { logger } from "@codraoss/core/logger";
import type { KvStore } from "@codraoss/core/ports";
import type { TokenTracker } from "@codraoss/core/token-tracker";
import { isPlausibleTokenBucket } from "./model-support";

// One KV value per job to limit subrequests.
const CHAIN_PROGRESS_TTL_SECONDS = 24 * 60 * 60;

// 3 = one full wave.
const MODEL_TIMEOUT_STRIKES = 3;

// Finite to avoid infinite retries on dead models.
const LAST_CANDIDATE_TIMEOUT_STRIKES = 6;

// Caps mis-parsed long delays.
const MAX_PERSISTED_COOLDOWN_MS = 5 * 60 * 1000;

export interface ModelCooldown {
  cooldownUntil: number;
  limitTokens?: number;
}

type StoredCooldown = { until?: unknown; limitTokens?: unknown };
type StoredShape = {
  files?: Record<string, unknown>;
  timeouts?: Record<string, unknown>;
  cooldowns?: Record<string, StoredCooldown>;
};

function positiveInts(
  source: Record<string, unknown> | undefined,
): Map<string, number> {
  const kept = new Map<string, number>();
  if (!source || typeof source !== "object") return kept;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0)
      kept.set(key, value);
  }
  return kept;
}

// Absolute deadline caps stale reads over-suppressing models.
function parseCooldowns(
  source: Record<string, StoredCooldown> | undefined,
): Map<string, ModelCooldown> {
  const kept = new Map<string, ModelCooldown>();
  if (!source || typeof source !== "object") return kept;

  const ceiling = Date.now() + MAX_PERSISTED_COOLDOWN_MS;
  for (const [model, value] of Object.entries(source)) {
    if (!value || typeof value !== "object") continue;
    const until =
      typeof value.until === "number" && Number.isFinite(value.until)
        ? value.until
        : 0;
    // Drop implausible limits; avoids indefinite suppression.
    const limitTokens =
      typeof value.limitTokens === "number" &&
      isPlausibleTokenBucket(value.limitTokens)
        ? value.limitTokens
        : undefined;
    if (until <= 0 && limitTokens === undefined) continue;
    kept.set(model, { cooldownUntil: Math.min(until, ceiling), limitTokens });
  }
  return kept;
}

function mergeCooldown(
  a: ModelCooldown | undefined,
  b: ModelCooldown,
): ModelCooldown {
  return {
    cooldownUntil: Math.max(a?.cooldownUntil ?? 0, b.cooldownUntil),
    // Sticky across repeated 429s.
    limitTokens: a?.limitTokens ?? b.limitTokens,
  };
}

export class ModelChainProgressStore {
  private loaded: Promise<Map<string, number>> | null = null;
  private timeouts = new Map<string, number>();

  // Prevents max() merge from resurrecting cleared strikes.
  private clearedTimeouts = new Set<string>();
  private cooldowns = new Map<string, ModelCooldown>();

  // Single-flight write; concurrent KV puts must not drop updates.
  private inFlightWrite: Promise<void> | null = null;
  private dirty = false;

  constructor(
    private readonly kv: KvStore,
    private readonly jobId: string | undefined,
    private readonly tracker?: TokenTracker,
  ) {}

  private get key() {
    return this.jobId ? `jobs:${this.jobId}:chain-progress` : null;
  }

  private load(): Promise<Map<string, number>> {
    if (this.loaded) return this.loaded;

    const key = this.key;
    this.loaded = (async () => {
      if (!key) return new Map<string, number>();
      try {
        this.tracker?.incrementSubrequests(1);
        const rawString = await this.kv.get(key);
        const raw = rawString ? JSON.parse(rawString) : null;
        if (!raw || typeof raw !== "object") return new Map<string, number>();

        // Legacy: bare label->index maps read as files.
        const stored = raw as StoredShape;
        const isNewShape =
          stored.files !== undefined ||
          stored.timeouts !== undefined ||
          stored.cooldowns !== undefined;
        this.timeouts = positiveInts(isNewShape ? stored.timeouts : undefined);
        for (const [model, value] of parseCooldowns(
          isNewShape ? stored.cooldowns : undefined,
        )) {
          this.cooldowns.set(
            model,
            mergeCooldown(this.cooldowns.get(model), value),
          );
        }
        return positiveInts(
          isNewShape ? stored.files : (raw as Record<string, unknown>),
        );
      } catch (error) {
        // Missing memo costs retries, not correctness.
        logger.warn(
          "Failed to read model chain progress; resuming from the primary model",
          {
            jobId: this.jobId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return new Map<string, number>();
      }
    })();
    return this.loaded;
  }

  async startIndexFor(label: string): Promise<number> {
    return (await this.load()).get(label) ?? 0;
  }

  async advance(label: string, nextIndex: number): Promise<void> {
    if (!this.key || nextIndex <= 0) return;

    const progress = await this.load();
    if ((progress.get(label) ?? 0) >= nextIndex) return;
    progress.set(label, nextIndex);
    this.dirty = true;

    return this.flush();
  }

  private flush(): Promise<void> {
    if (this.inFlightWrite) return this.inFlightWrite;

    this.inFlightWrite = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          await this.writeOnce();
        }
      } finally {
        this.inFlightWrite = null;
      }
    })();

    return this.inFlightWrite;
  }

  private async writeOnce(): Promise<void> {
    const key = this.key;
    if (!key) return;

    const progress = await this.load();
    try {
      // Merge via max() so concurrent invocations don't drop labels.
      this.tracker?.incrementSubrequests(1);
      const rawString = await this.kv.get(key);
      const raw = rawString ? JSON.parse(rawString) : null;
      if (raw && typeof raw === "object") {
        const stored = raw as StoredShape;
        const isNewShape =
          stored.files !== undefined ||
          stored.timeouts !== undefined ||
          stored.cooldowns !== undefined;
        for (const [label, value] of positiveInts(
          isNewShape ? stored.files : (raw as Record<string, unknown>),
        )) {
          if (value > (progress.get(label) ?? 0)) progress.set(label, value);
        }
        for (const [model, value] of positiveInts(
          isNewShape ? stored.timeouts : undefined,
        )) {
          // Success outranks stored tally.
          if (this.clearedTimeouts.has(model)) continue;
          if (value > (this.timeouts.get(model) ?? 0))
            this.timeouts.set(model, value);
        }
        for (const [model, value] of parseCooldowns(
          isNewShape ? stored.cooldowns : undefined,
        )) {
          this.cooldowns.set(
            model,
            mergeCooldown(this.cooldowns.get(model), value),
          );
        }
      }

      this.tracker?.incrementSubrequests(1);
      await this.kv.put(
        key,
        JSON.stringify({
          files: Object.fromEntries(progress),
          timeouts: Object.fromEntries(this.timeouts),
          cooldowns: Object.fromEntries(
            Array.from(this.cooldowns, ([model, entry]) => [
              model,
              { until: entry.cooldownUntil, limitTokens: entry.limitTokens },
            ]),
          ),
        }),
        { expirationTtl: CHAIN_PROGRESS_TTL_SECONDS },
      );
    } catch (error) {
      logger.warn(
        "Failed to persist model chain progress; the next attempt will retry from the same model",
        {
          jobId: this.jobId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  async clear(label: string): Promise<void> {
    const progress = await this.load();
    progress.delete(label);
  }

  async noteTimeout(modelId: string): Promise<void> {
    if (!this.key) return;
    await this.load();
    this.timeouts.set(modelId, (this.timeouts.get(modelId) ?? 0) + 1);
    this.dirty = true;
    return this.flush();
  }

  async noteSuccess(modelId: string): Promise<void> {
    if (!this.key) return;
    await this.load();
    if (!this.timeouts.has(modelId)) return;
    this.timeouts.delete(modelId);
    this.clearedTimeouts.add(modelId);
    this.dirty = true;
    return this.flush();
  }

  async isTimingOut(modelId: string): Promise<boolean> {
    await this.load();
    return (this.timeouts.get(modelId) ?? 0) >= MODEL_TIMEOUT_STRIKES;
  }

  // Chain tails have no fallback.
  async isTimingOutTerminally(modelId: string): Promise<boolean> {
    await this.load();
    return (this.timeouts.get(modelId) ?? 0) >= LAST_CANDIDATE_TIMEOUT_STRIKES;
  }

  async loadCooldowns(): Promise<Map<string, ModelCooldown>> {
    await this.load();
    return new Map(this.cooldowns);
  }

  // Sync; flushPending() coalesces writes.
  noteRateLimit(modelId: string, entry: ModelCooldown): void {
    if (!this.key) return;
    this.cooldowns.set(
      modelId,
      mergeCooldown(this.cooldowns.get(modelId), entry),
    );
    this.dirty = true;
  }

  flushPending(): Promise<void> {
    if (!this.key || !this.dirty) return Promise.resolve();
    return this.flush();
  }
}
