import { afterEach, describe, expect, it, vi } from "vitest";
import { isRetryableModelError } from "@codraoss/models";
import {
  createTestEnv,
  saveTestProviderApiKey,
  createTestModelRunner,
} from "../../../../test/helpers";
import { defaultRepoConfig } from "@codraoss/schema";
import { TokenTracker } from "@codraoss/core/token-tracker";

describe("ModelRunner: budget breakers and provider availability limits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
