import { afterEach, describe, expect, it, vi } from "vitest";
import { isRetryableModelError } from "@codraoss/models";
import { reviewWithCloudflare } from "@codraoss/models/cloudflare";
import { reviewWithGoogle } from "@codraoss/models/google";
import { MODEL_TIMEOUT_MAX_MS } from "../../src/limits";
import {
  createTestEnv,
  saveTestProviderApiKey,
  createTestModelRunner,
} from "../../../../test/helpers";
import { defaultRepoConfig } from "@codraoss/schema";

// The retry ladder: inline retries, Retry-After, and which exhausted runs report as retryable.
describe("ModelRunner: transient failures and the retry ladder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries Google once for transient 524 edge timeouts", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 524, message: "A timeout occurred." },
          }),
          { status: 524, headers: { "content-type": "application/json" } },
        ),
      )
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

    const response = await reviewWithGoogle(
      { apiKey: "test-key" },
      "gemini-3.1-pro-preview",
      { systemPrompt: "system", userPrompt: "user" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.rawText).toContain('"findings"');
  });

  it("honours a Retry-After it can actually wait out", async () => {
    // retry-after: 3s is inside GEMINI_MAX_RETRY_DELAY_MS (5s), so the retry fires at exactly 3s
    // -- the provider's own cool-off, not our default backoff.
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: { code: 429, message: "Rate limited." } }),
            {
              status: 429,
              headers: {
                "content-type": "application/json",
                "retry-after": "3",
              },
            },
          ),
        )
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

      const promise = reviewWithGoogle(
        { apiKey: "test-key" },
        "gemini-3.1-pro-preview",
        { systemPrompt: "system", userPrompt: "user" },
      );
      promise.catch(() => {});

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(2_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      const response = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(response.rawText).toContain('"findings"');
    } finally {
      vi.useRealTimers();
    }
  });

  // A cool-off we cannot honour isn't worth a retry: waking early earns the same 429.

  it("gives up immediately on a Retry-After longer than the in-call sleep cap", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 429, message: "Rate limited." } }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "56",
            },
          },
        ),
      );

    await expect(
      reviewWithGoogle({ apiKey: "test-key" }, "gemini-3.1-pro-preview", {
        systemPrompt: "system",
        userPrompt: "user",
      }),
    ).rejects.toThrow(/429/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The free-tier buckets are per-minute, so an unstated cool-off is ~60s by construction. Backing
  // off ~0.8s then ~1.6s bought two more 429s and two more full prompt transmissions for nothing.
  it("gives up immediately on a 429 that states no cool-off at all", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 429, message: "Resource has been exhausted." },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
      );

    await expect(
      reviewWithGoogle({ apiKey: "test-key" }, "gemini-3.1-pro-preview", {
        systemPrompt: "system",
        userPrompt: "user",
      }),
    ).rejects.toThrow(/429/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still retries a 5xx with no Retry-After, which is a genuinely transient blip", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: 503, message: "The model is overloaded." },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      )
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

    const response = await reviewWithGoogle(
      { apiKey: "test-key" },
      "gemini-3.1-pro-preview",
      { systemPrompt: "system", userPrompt: "user" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.rawText).toContain('"findings"');
  });

  it("does not spend an extra queue slice retrying the same Cloudflare model inline", async () => {
    let attempts = 0;
    const env = createTestEnv({
      AI: {
        async run() {
          attempts++;
          throw new Error("temporary provider error");
        },
      } as any,
    });

    await expect(
      reviewWithCloudflare(env.AI, "@cf/zai-org/glm-4.7-flash", {
        systemPrompt: "system",
        userPrompt: "user",
      }),
    ).rejects.toThrow("temporary provider error");
    expect(attempts).toBe(1);
  });

  it("aborts and fails fast (as a retryable timeout) when a Cloudflare model hangs past the timeout", async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | undefined;
      const env = createTestEnv({
        AI: {
          run(
            _model: string,
            _request: any,
            options?: { signal?: AbortSignal },
          ) {
            capturedSignal = options?.signal;
            // Model never responds -- only the timeout can end this call.
            return new Promise(() => {});
          },
        } as any,
      });

      const promise = reviewWithCloudflare(
        env.AI,
        "@cf/zai-org/glm-4.7-flash",
        {
          systemPrompt: "system",
          userPrompt: "user",
        },
      );
      // Prevent an unhandled-rejection warning while the timer is still pending.
      promise.catch(() => {});

      // Derived, not hardcoded: pinning the number here meant raising the ceiling made this test
      // advance past nothing, so the promise never settled and the run hung on fake timers.
      await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MAX_MS);

      await expect(promise).rejects.toThrow(
        `timed out after ${MODEL_TIMEOUT_MAX_MS}ms`,
      );
      // The underlying Workers-AI request was actually cancelled, not just abandoned.
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies an exhausted run of Google 5xx failures as retryable (not a permanent file failure)", async () => {
    // A sustained 5xx outage defers rather than fails. Fresh Response per call: a body reads once.
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: 500,
                message: "Internal error encountered.",
                status: "INTERNAL",
              },
            }),
            { status: 500, headers: { "content-type": "application/json" } },
          ),
      );
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = createTestModelRunner(env);

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
    expect(fetchMock).toHaveBeenCalled();
  });
});
