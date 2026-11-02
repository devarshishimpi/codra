import { afterEach, describe, expect, it, vi } from "vitest";
import { nextChainIndexOf, ModelRunner } from "@codraoss/models";
import { defaultRepoConfig } from "@codraoss/schema";
import { TokenTracker } from "@codraoss/core/token-tracker";
import {
  createTestEnv,
  saveTestProviderApiKey,
  createTestModelRunner,
} from "../../../../test/helpers";

// ~55s per invocation: a slow head never reaches the tail, so resume must pick up where it left off.
describe("model chain resume", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const file = {
    path: "src/app.ts",
    lineCount: 1,
    hunks: [],
    isDeleted: false,
    isBinary: false,
    isNew: false,
    previousPath: null,
  };

  const chainConfig = {
    ...defaultRepoConfig,
    model: {
      main: "gemini-3.1-pro-preview",
      // 3 entries: the memo only records progress when there's still somewhere left to go.
      fallbacks: ["gemini-2.5-pro", "gemini-3.1-flash-lite"],
      size_overrides: [],
    },
  };

  const gemini = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const ok = () =>
    gemini(200, {
      candidates: [
        {
          content: {
            parts: [
              {
                text: '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}',
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
  const unavailable = () =>
    gemini(503, {
      error: {
        code: 503,
        message: "The model is overloaded.",
        status: "UNAVAILABLE",
      },
    });
  const rateLimited = () =>
    gemini(429, {
      error: {
        code: 429,
        message:
          "Resource exhausted. limit: 16000, model: gemini. Please retry in 30s.",
        status: "RESOURCE_EXHAUSTED",
      },
    });

  async function review(service: ModelRunner) {
    return service.reviewFile({
      file,
      prTitle: "Test",
      prDescription: null,
      config: chainConfig,
      totalLineCount: 1,
    } as Parameters<ModelRunner["reviewFile"]>[0]);
  }

  it("resumes at the model after the ones that already failed, instead of replaying them", async () => {
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    // Near the subrequest cap, so the breaker ends the chain after the primary, matching prod.
    const tracker = new TokenTracker();
    tracker.incrementSubrequests(40);
    const first = createTestModelRunner(env, tracker, {
      jobId: "job-chain-resume",
    });

    const firstFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => unavailable());
    await expect(review(first)).rejects.toThrow(/retrying later/);
    const walked = firstFetch.mock.calls.map((call) => String(call[0]));
    expect(walked.every((url) => url.includes("gemini-3.1-pro-preview"))).toBe(
      true,
    );
    vi.restoreAllMocks();

    const second = createTestModelRunner(env, undefined, {
      jobId: "job-chain-resume",
    });
    const secondFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => ok());
    await review(second);

    const retried = secondFetch.mock.calls.map((call) => String(call[0]));
    expect(
      retried.every((url) => !url.includes("gemini-3.1-pro-preview")),
    ).toBe(true);
    expect(retried.length).toBeGreaterThan(0);
  });

  it("does not record progress past a model that was only rate-limited", async () => {
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = createTestModelRunner(env, undefined, {
      jobId: "job-chain-429",
    });

    // 429 means "same model, later"; advancing past it would skip a healthy model for good.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => rateLimited());
    const failure = await review(service).catch((error) => error);

    expect(nextChainIndexOf(failure)).toBeNull();
  });

  it("stops the chain the moment the invocation runs out of subrequests", async () => {
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = createTestModelRunner(env, undefined, {
      jobId: "job-subrequests",
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(
        new Error("Too many subrequests by single Worker invocation."),
      );
    const failure = await review(service).catch((error) => error);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(failure?.message)).toMatch(/retrying later/);
    expect(nextChainIndexOf(failure)).toBeNull();
  });

  it("reads nothing off an error that never walked a chain", () => {
    expect(nextChainIndexOf(new Error("boom"))).toBeNull();
    expect(nextChainIndexOf(undefined)).toBeNull();
    // 0 is "no progress", and must not be mistaken for a recorded index.
    expect(
      nextChainIndexOf(Object.assign(new Error("x"), { nextChainIndex: 0 })),
    ).toBeNull();
    expect(
      nextChainIndexOf(Object.assign(new Error("x"), { nextChainIndex: 2 })),
    ).toBe(2);
  });
});
