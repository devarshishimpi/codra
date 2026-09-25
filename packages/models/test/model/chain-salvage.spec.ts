import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultRepoConfig, type ResolvedModelConfig } from "@codraoss/schema";
import { TokenTracker } from "@codraoss/core/token-tracker";

import {
  runModelChain,
  type ModelReviewContext,
} from "../../src/internal/model-review-chain";
import { ModelChainProgressStore } from "../../src/internal/model-chain-progress";
import { ModelRateLimitBook } from "../../src/internal/model-rate-limits";
import {
  attachPartialResponse,
  UnparseableModelResponseError,
} from "../../src/types";
import { MODEL_FALLBACK_CHAIN_BUDGET_MS } from "../../src/limits";

function fakeKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function resolved(modelName: string): ResolvedModelConfig {
  return {
    modelId: modelName,
    providerId: "00000000-0000-4000-8000-000000000000",
    providerName: "Google",
    apiFormat: "gemini",
    modelName,
    updatedAt: new Date().toISOString(),
    providerEnabled: true,
    baseUrl: null,
    encryptedApiKey: "key",
  };
}

const ANSWER = '{"findings":[]}';

type Attempt = { model: string; timeoutMs: number | undefined };

function makeContext(input: {
  chain: string[];
  call: (
    model: string,
    attempt: number,
  ) => Promise<{
    rawText: string;
    inputTokens: number;
    outputTokens: number;
    modelUsed: string;
    provider: string;
  }>;
  attempts: Attempt[];
  tracker?: TokenTracker;
}): ModelReviewContext {
  let callCount = 0;
  return {
    selectModel: () => ({
      primary: input.chain[0],
      fallbacks: input.chain.slice(1),
    }),
    resolveModel: async (model: string) => resolved(model),
    isProviderUnavailable: async () => false,
    markProviderUnavailable: async () => {},
    callResolvedModel: async (
      model: ResolvedModelConfig,
      _modelInput: unknown,
      timeoutMs?: number,
    ) => {
      input.attempts.push({ model: model.modelName, timeoutMs });
      return input.call(model.modelName, callCount++);
    },
    tracker: input.tracker,
    jobId: "job-1",
    aiBinding: undefined,
    rateLimits: new ModelRateLimitBook(),
    asyncUnsupportedModels: new Set<string>(),
    chainProgress: new ModelChainProgressStore(fakeKv(), "job-1"),
  } as unknown as ModelReviewContext;
}

function truncatedError(model: string, rawText: string) {
  const error = new UnparseableModelResponseError(
    model,
    "finishReason=MAX_TOKENS",
  );
  attachPartialResponse(error, {
    rawText,
    inputTokens: 1_200,
    outputTokens: 8_000,
    modelUsed: model,
    provider: "Google",
  });
  return error;
}

function chainParams(
  overrides: Partial<Parameters<typeof runModelChain>[1]> = {},
) {
  return {
    systemPrompt: "system",
    userPrompt: "user",
    responseSchema: { name: "x", schema: {} } as never,
    timeoutMs: 50_000,
    label: "src/app.ts",
    totalLineCount: 400,
    config: defaultRepoConfig,
    parse: (rawText: string) => JSON.parse(rawText) as unknown,
    ...overrides,
  } as Parameters<typeof runModelChain>[1];
}

describe("runModelChain: salvaging a truncated last answer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses the partial answer when the last model runs out of room", async () => {
    const attempts: Attempt[] = [];
    const tracker = new TokenTracker();
    const ctx = makeContext({
      chain: ["gemini-2.5-flash"],
      attempts,
      tracker,
      call: async (model) => {
        throw truncatedError(model, ANSWER);
      },
    });

    const result = await runModelChain(ctx, chainParams());

    expect(result.parsed).toEqual({ findings: [] });
    expect(result.modelUsed).toBe("gemini-2.5-flash");
    expect(result.degraded).toBe("truncated");
    expect(tracker.getTotalUsage()).toMatchObject({
      input: 1_200,
      output: 8_000,
    });
    expect(attempts).toHaveLength(1);
  });

  it("does not salvage while a better model is still available", async () => {
    const attempts: Attempt[] = [];
    const ctx = makeContext({
      chain: ["gemini-2.5-flash", "gemini-2.5-pro"],
      attempts,
      call: async (model) => {
        if (model === "gemini-2.5-flash") throw truncatedError(model, ANSWER);
        return {
          rawText: '{"findings":["real"]}',
          inputTokens: 10,
          outputTokens: 20,
          modelUsed: model,
          provider: "Google",
        };
      },
    });

    const result = await runModelChain(ctx, chainParams());

    expect(attempts.map((a) => a.model)).toEqual([
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ]);
    expect(result.parsed).toEqual({ findings: ["real"] });
    expect(result.degraded).toBeUndefined();
  });

  it("fails normally when the partial answer cannot be parsed", async () => {
    const attempts: Attempt[] = [];
    const ctx = makeContext({
      chain: ["gemini-2.5-flash"],
      attempts,
      call: async (model) => {
        throw truncatedError(model, '{"findings":[{"path":');
      },
    });

    await expect(runModelChain(ctx, chainParams())).rejects.toThrow(
      /no reviewable output/i,
    );
  });

  it("leaves an ordinary failure on the last model alone", async () => {
    const attempts: Attempt[] = [];
    const ctx = makeContext({
      chain: ["gemini-2.5-flash"],
      attempts,
      call: async () => {
        throw new UnparseableModelResponseError("gemini-2.5-flash", "empty");
      },
    });

    await expect(runModelChain(ctx, chainParams())).rejects.toThrow(/empty/);
  });
});

describe("runModelChain: sharing the invocation time budget across rungs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function withClock() {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    return {
      spend: (ms: number) => {
        now += ms;
      },
    };
  }

  it("gives a single-model chain everything it asked for", async () => {
    withClock();
    const attempts: Attempt[] = [];
    const ctx = makeContext({
      chain: ["gemini-2.5-flash"],
      attempts,
      call: async (model) => ({
        rawText: ANSWER,
        inputTokens: 1,
        outputTokens: 1,
        modelUsed: model,
        provider: "Google",
      }),
    });

    await runModelChain(ctx, chainParams({ timeoutMs: 50_000 }));

    expect(attempts[0].timeoutMs).toBe(50_000);
  });

  it("holds back room so a fallback still runs in the same invocation", async () => {
    const clock = withClock();
    const attempts: Attempt[] = [];
    const ctx = makeContext({
      chain: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.1-flash-lite"],
      attempts,
      call: async (model, attempt) => {
        clock.spend(attempts[attempt].timeoutMs ?? 0);
        throw new UnparseableModelResponseError(model, "no answer");
      },
    });

    await expect(
      runModelChain(ctx, chainParams({ timeoutMs: 50_000 })),
    ).rejects.toThrow();

    expect(attempts.map((a) => a.timeoutMs)).toEqual([35_000, 20_000]);
    expect(attempts.map((a) => a.model)).toEqual([
      "gemini-2.5-flash",
      "gemini-2.5-pro",
    ]);
  });

  it("never grants more than the chain budget in total", async () => {
    const clock = withClock();
    const attempts: Attempt[] = [];
    const ctx = makeContext({
      chain: ["a", "b", "c", "d"],
      attempts,
      call: async (model, attempt) => {
        clock.spend(attempts[attempt].timeoutMs ?? 0);
        throw new UnparseableModelResponseError(model, "no answer");
      },
    });

    await expect(
      runModelChain(ctx, chainParams({ timeoutMs: 50_000 })),
    ).rejects.toThrow();

    const granted = attempts.reduce((sum, a) => sum + (a.timeoutMs ?? 0), 0);
    expect(granted).toBeLessThanOrEqual(MODEL_FALLBACK_CHAIN_BUDGET_MS);
  });

  it("never grants a rung more than it asked for", async () => {
    const clock = withClock();
    const attempts: Attempt[] = [];
    const ctx = makeContext({
      chain: ["a", "b", "c"],
      attempts,
      call: async (model, attempt) => {
        clock.spend(attempts[attempt].timeoutMs ?? 0);
        throw new UnparseableModelResponseError(model, "no answer");
      },
    });

    await expect(
      runModelChain(ctx, chainParams({ timeoutMs: 12_000 })),
    ).rejects.toThrow();

    expect(attempts.every((a) => (a.timeoutMs ?? 0) <= 12_000)).toBe(true);
    expect(attempts).toHaveLength(3);
  });
});
