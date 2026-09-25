import { afterEach, describe, expect, it, vi } from "vitest";
import { isRetryableModelError } from "@codraoss/models";

import {
  createTestEnv,
  saveTestProviderApiKey,
  createTestModelRunner,
} from "../../../../test/helpers";
import { defaultRepoConfig } from "@codraoss/schema";
import { TokenTracker } from "@codraoss/core/token-tracker";

// Chain fallback, budget breakers, provider availability. Inline retry ladder: service-retries.spec.ts.
describe("ModelRunner: chain fallback, budget breakers and provider availability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tries the smaller Google fallback after the primary Google model fails", async () => {
    let cloudflareCalls = 0;
    const gemini500 = () =>
      new Response(
        JSON.stringify({
          error: {
            code: 500,
            message: "Internal error encountered.",
            status: "INTERNAL",
          },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    // Primary fails 3x, fallback succeeds on the 4th call.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(gemini500())
      .mockResolvedValueOnce(gemini500())
      .mockResolvedValueOnce(gemini500())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
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
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const env = createTestEnv({
      AI: {
        async run() {
          cloudflareCalls++;
          return {
            response: JSON.stringify({
              findings: [],
              overall_correctness: "patch is correct",
              overall_explanation: "ok",
              overall_confidence_score: 0.9,
            }),
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          };
        },
      } as any,
    });
    await saveTestProviderApiKey(env);
    const service = createTestModelRunner(env);

    const response = await service.reviewFile({
      file: {
        path: "src/app.ts",
        lineCount: 1,
        hunks: [],
        isDeleted: false,
        isBinary: false,
        isNew: false,
        previousPath: null,
      },
      prTitle: "Test",
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: "gemini-3.1-pro-preview",
          fallbacks: ["gemini-2.5-pro", "@cf/zai-org/glm-4.7-flash"],
          size_overrides: [],
        },
      },
      totalLineCount: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/models/gemini-3.1-pro-preview:generateContent",
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "/models/gemini-3.1-pro-preview:generateContent",
    );
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      "/models/gemini-3.1-pro-preview:generateContent",
    );
    expect(String(fetchMock.mock.calls[3][0])).toContain(
      "/models/gemini-2.5-pro:generateContent",
    );
    expect(cloudflareCalls).toBe(0);
    expect(response.modelUsed).toBe("gemini-2.5-pro");
  });

  // Unparseable 200 counts as that model's own failure (parse is inside the per-model try).
  it("falls through to the next model when the primary returns an unparseable body", async () => {
    const geminiText = (text: string) =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(geminiText("I am unable to review this diff."))
      .mockResolvedValueOnce(
        geminiText(
          '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}',
        ),
      );

    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = createTestModelRunner(env);

    const response = await service.reviewFile({
      file: {
        path: "src/app.ts",
        lineCount: 1,
        hunks: [],
        isDeleted: false,
        isBinary: false,
        isNew: false,
        previousPath: null,
      },
      prTitle: "Test",
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: "gemini-3.1-pro-preview",
          fallbacks: ["gemini-2.5-pro"],
          size_overrides: [],
        },
      },
      totalLineCount: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.modelUsed).toBe("gemini-2.5-pro");
  });

  // Three `continue` paths can leave `lastError` undefined, matching no retry predicate.
  it("defers rather than throwing undefined when every model is skipped", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = createTestModelRunner(env);
    // A learned bucket below the prompt size makes skipReason refuse every model.
    (
      service as unknown as { rateLimits: { skipReason: () => string } }
    ).rateLimits.skipReason = () => "prompt too large for its bucket";

    const promise = service.reviewFile({
      file: {
        path: "src/app.ts",
        lineCount: 1,
        hunks: [],
        isDeleted: false,
        isBinary: false,
        isNew: false,
        previousPath: null,
      },
      prTitle: "Test",
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: "gemini-3.1-pro-preview",
          fallbacks: ["gemini-2.5-pro"],
          size_overrides: [],
        },
      },
      totalLineCount: 1,
    });

    await expect(promise).rejects.toThrow(
      /No configured review model was attempted/,
    );
    await promise.catch((error) =>
      expect(isRetryableModelError(error)).toBe(true),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Regression: the tail used to be exempt from the timeout breaker, wasting a full budget per unit.
  it("drops even the last candidate once it has never answered on this job", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const env = createTestEnv();
    await saveTestProviderApiKey(env);

    // Six strikes exceeds the tail's higher bar.
    await env.APP_KV.put(
      "jobs:job-tail-drop:chain-progress",
      JSON.stringify({
        timeouts: { "gemini-3.1-pro-preview": 6, "gemini-2.5-pro": 6 },
      }),
    );
    const service = createTestModelRunner(env, undefined, {
      jobId: "job-tail-drop",
    });

    const promise = service.reviewFile({
      file: {
        path: "src/app.ts",
        lineCount: 1,
        hunks: [],
        isDeleted: false,
        isBinary: false,
        isNew: false,
        previousPath: null,
      },
      prTitle: "Test",
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: "gemini-3.1-pro-preview",
          fallbacks: ["gemini-2.5-pro"],
          size_overrides: [],
        },
      },
      totalLineCount: 1,
    });

    await expect(promise).rejects.toThrow(
      /No configured review model was attempted.*repeated timeouts/,
    );
    await promise.catch((error) =>
      expect(isRetryableModelError(error)).toBe(true),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Same rule, other side: a merely-slow tail still gets its shot since deferring untried is worse.
  it("still tries the last candidate when it is only mid-chain slow", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const env = createTestEnv();
    await saveTestProviderApiKey(env);

    // Three strikes drops a model mid-chain but not at the tail.
    await env.APP_KV.put(
      "jobs:job-tail-slow:chain-progress",
      JSON.stringify({
        timeouts: { "gemini-3.1-pro-preview": 3, "gemini-2.5-pro": 3 },
      }),
    );
    const service = createTestModelRunner(env, undefined, {
      jobId: "job-tail-slow",
    });

    const response = await service.reviewFile({
      file: {
        path: "src/app.ts",
        lineCount: 1,
        hunks: [],
        isDeleted: false,
        isBinary: false,
        isNew: false,
        previousPath: null,
      },
      prTitle: "Test",
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: "gemini-3.1-pro-preview",
          fallbacks: ["gemini-2.5-pro"],
          size_overrides: [],
        },
      },
      totalLineCount: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/models/gemini-2.5-pro:generateContent",
    );
    expect(response.modelUsed).toBe("gemini-2.5-pro");
  });

  it("surfaces a permanent config error rather than deferring", async () => {
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = createTestModelRunner(env);

    const promise = service.reviewFile({
      file: {
        path: "src/app.ts",
        lineCount: 1,
        hunks: [],
        isDeleted: false,
        isBinary: false,
        isNew: false,
        previousPath: null,
      },
      prTitle: "Test",
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: "definitely-not-a-configured-model",
          fallbacks: [],
          size_overrides: [],
        },
      },
      totalLineCount: 1,
    });

    await expect(promise).rejects.toThrow(/is not configured/);
    await promise.catch((error) =>
      expect(isRetryableModelError(error)).toBe(false),
    );
  });

  it("still tries the primary model even when the shared job budget is already near the subrequest limit", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const tracker = new TokenTracker();
    tracker.incrementSubrequests(40); // above near-limit threshold (50 - 25 margin)
    const service = createTestModelRunner(env, tracker);

    const response = await service.reviewFile({
      file: {
        path: "src/app.ts",
        lineCount: 1,
        hunks: [],
        isDeleted: false,
        isBinary: false,
        isNew: false,
        previousPath: null,
      },
      prTitle: "Test",
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: "gemini-3.1-pro-preview",
          fallbacks: ["gemini-2.5-pro"],
          size_overrides: [],
        },
      },
      totalLineCount: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.modelUsed).toBe("gemini-3.1-pro-preview");
  });

  // Counterpart: primary is skipped only when budget truly can't cover the call, not merely tight.
  it("will not commit a prompt when the budget cannot cover the call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const tracker = new TokenTracker();
    // Leaves 5 of the 50-subrequest cap, under the headroom one call may need.
    tracker.incrementSubrequests(45);
    const service = createTestModelRunner(env, tracker);

    const promise = service.reviewFile({
      file: {
        path: "src/app.ts",
        lineCount: 1,
        hunks: [],
        isDeleted: false,
        isBinary: false,
        isNew: false,
        previousPath: null,
      },
      prTitle: "Test",
      prDescription: null,
      config: {
        ...defaultRepoConfig,
        model: {
          main: "gemini-3.1-pro-preview",
          fallbacks: ["gemini-2.5-pro"],
          size_overrides: [],
        },
      },
      totalLineCount: 1,
    });

    // Deferred, not failed: a fresh invocation has a fresh budget.
    await expect(promise).rejects.toThrow(/retrying later/);
    await promise.catch((error) =>
      expect(isRetryableModelError(error)).toBe(true),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips remaining fallback models (instead of spending more of the shared budget) once near the subrequest limit", async () => {
    // Fresh Response per call (body reads once); 503 not 500 keeps the failure retryable.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 503,
                message: "The model is overloaded and currently unavailable.",
                status: "UNAVAILABLE",
              },
            }),
            { status: 503, headers: { "content-type": "application/json" } },
          ),
      );
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const tracker = new TokenTracker();
    tracker.incrementSubrequests(40); // above near-limit threshold (50 - 25 margin)
    const service = createTestModelRunner(env, tracker);

    await expect(
      service.reviewFile({
        file: {
          path: "src/app.ts",
          lineCount: 1,
          hunks: [],
          isDeleted: false,
          isBinary: false,
          isNew: false,
          previousPath: null,
        },
        prTitle: "Test",
        prDescription: null,
        config: {
          ...defaultRepoConfig,
          model: {
            main: "gemini-3.1-pro-preview",
            fallbacks: ["gemini-2.5-pro"],
            size_overrides: [],
          },
        },
        totalLineCount: 1,
      }),
    ).rejects.toSatisfy(isRetryableModelError);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toContain(
        "/models/gemini-3.1-pro-preview:generateContent",
      );
    }
  });

  it("skips Cloudflare for the rest of a job after allocation is exhausted", async () => {
    let cloudflareCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"findings":[]}' }] } }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const env = createTestEnv({
      AI: {
        async run() {
          cloudflareCalls++;
          throw new Error("Cloudflare daily free allocation exhausted (4006)");
        },
      } as any,
    });
    await saveTestProviderApiKey(env);
    const service = createTestModelRunner(env, undefined, {
      jobId: "job-provider-skip",
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
    const config = {
      ...defaultRepoConfig,
      model: {
        main: "@cf/zai-org/glm-4.7-flash",
        fallbacks: ["gemini-3.1-pro-preview"],
        size_overrides: [],
      },
    };

    await service.reviewFile({
      file,
      prTitle: "Test",
      prDescription: null,
      config,
      totalLineCount: 1,
    });
    await service.reviewFile({
      file: { ...file, path: "src/other.ts" },
      prTitle: "Test",
      prDescription: null,
      config,
      totalLineCount: 1,
    });

    expect(cloudflareCalls).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
