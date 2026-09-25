export const MODEL_TIMEOUT_BASE_MS = 20_000;
const MODEL_TIMEOUT_PER_LINE_MS = 100;
const MODEL_TIMEOUT_FREE_LINES = 100;
// Ceiling stays under 120s exceededCpu limit, leaving room to fail over.
export const MODEL_TIMEOUT_MAX_MS = 50_000;

// Slightly above MODEL_TIMEOUT_MAX_MS so a large diff can use the full ceiling before deferring.
export const MODEL_FALLBACK_CHAIN_BUDGET_MS = 55_000;

export const MODEL_TIMEOUT_PER_1K_OUTPUT_MS = 1_200;

export function adaptiveModelTimeoutMs(
  diffLineCount: number | null | undefined,
  outputBudgetTokens?: number | null,
): number {
  const lines =
    typeof diffLineCount === "number" && Number.isFinite(diffLineCount)
      ? Math.max(0, diffLineCount)
      : 0;
  const scaled =
    MODEL_TIMEOUT_BASE_MS +
    Math.max(0, lines - MODEL_TIMEOUT_FREE_LINES) * MODEL_TIMEOUT_PER_LINE_MS;

  const budget =
    typeof outputBudgetTokens === "number" &&
    Number.isFinite(outputBudgetTokens)
      ? Math.max(0, outputBudgetTokens)
      : 0;
  const answerAllowance =
    (Math.max(0, budget - OUTPUT_TOKENS_FLOOR) / 1_000) *
    MODEL_TIMEOUT_PER_1K_OUTPUT_MS;

  return Math.min(MODEL_TIMEOUT_MAX_MS, scaled + answerAllowance);
}

// Per-candidate, not the old `candidates * 8` diff-line proxy: 12 findings fell under the 100-line free allowance and collapsed to the 20s base, so verification timed out and later chain rungs were skipped.
export const VERIFY_TIMEOUT_FLOOR_MS = 30_000;
const VERIFY_TIMEOUT_FREE_CANDIDATES = 10;
const VERIFY_TIMEOUT_PER_CANDIDATE_MS = 1_200;

export function verifyTimeoutMs(candidateCount: number): number {
  const extra = Math.max(0, candidateCount - VERIFY_TIMEOUT_FREE_CANDIDATES);
  return Math.min(
    MODEL_TIMEOUT_MAX_MS,
    VERIFY_TIMEOUT_FLOOR_MS + extra * VERIFY_TIMEOUT_PER_CANDIDATE_MS,
  );
}

export function clampTimeoutToChainBudget(timeoutMs: number): number {
  return Math.min(timeoutMs, MODEL_FALLBACK_CHAIN_BUDGET_MS);
}

export const MODEL_MIN_VIABLE_ATTEMPT_MS = 8_000;

export const MODEL_FALLBACK_RESERVE_MS = 20_000;

// Returns 0 to defer the file to a fresh invocation.
export function chainAttemptTimeoutMs(input: {
  requestedMs: number;
  remainingChainMs: number;
  hasAnotherModel: boolean;
}): number {
  const { requestedMs, remainingChainMs, hasAnotherModel } = input;
  if (remainingChainMs < MODEL_MIN_VIABLE_ATTEMPT_MS) return 0;
  if (!hasAnotherModel) return Math.min(requestedMs, remainingChainMs);

  const withReserve = remainingChainMs - MODEL_FALLBACK_RESERVE_MS;
  return Math.min(
    requestedMs,
    withReserve >= MODEL_MIN_VIABLE_ATTEMPT_MS ? withReserve : remainingChainMs,
  );
}

// 3 of the 6 pool connections reserved for KV/GitHub.
export const MAX_CONCURRENT_MODEL_CALLS = 3;

const OUTPUT_TOKENS_PER_FINDING = 340;
const OUTPUT_TOKENS_PER_FILE_ENTRY = 160;
export const OUTPUT_TOKENS_FLOOR = 8_192;

export function reviewOutputBudgetTokens(input: {
  findingCap: number;
  fileCount: number;
}): number {
  const files = Math.max(1, input.fileCount);
  const findings = Math.max(1, input.findingCap) * files;
  return Math.max(
    OUTPUT_TOKENS_FLOOR,
    findings * OUTPUT_TOKENS_PER_FINDING + files * OUTPUT_TOKENS_PER_FILE_ENTRY,
  );
}

export function resolveOutputTokenCeiling(
  requested: number | undefined,
  providerMax: number,
  providerDefault: number,
): number {
  if (
    typeof requested !== "number" ||
    !Number.isFinite(requested) ||
    requested <= 0
  ) {
    return Math.min(providerDefault, providerMax);
  }
  return Math.min(providerMax, Math.max(providerDefault, Math.ceil(requested)));
}

// Gemini thinking budget counts against maxOutputTokens, so it must stay bounded to 1024-8192.
export function geminiThinkingBudgetTokens(answerBudgetTokens: number): number {
  return Math.min(8_192, Math.max(1_024, Math.floor(answerBudgetTokens / 4)));
}

const SUBREQUESTS_PER_MODEL_ATTEMPT = 3;

export const SUBREQUEST_HEADROOM_FOR_MODEL_CALL =
  SUBREQUESTS_PER_MODEL_ATTEMPT * MAX_CONCURRENT_MODEL_CALLS;

// Queue wait time is excluded from the caller's timeout budget.
export class ModelCallGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit = MAX_CONCURRENT_MODEL_CALLS) {}

  async run<T>(
    fn: () => Promise<T>,
    onAcquired?: (waitedMs: number) => void,
  ): Promise<T> {
    const startedWaiting = Date.now();
    await this.acquire();
    onAcquired?.(Date.now() - startedWaiting);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get queueDepth() {
    return this.waiters.length;
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release() {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.active--;
    }
  }
}
