import { afterEach, describe, expect, it, vi } from "vitest";
import { isRetryableModelError } from "@codraoss/models";
import { createTestEnv, saveTestProviderApiKey } from "../helpers";
import { defaultRepoConfig } from "@codraoss/schema";
import { makeModelFactory } from "@server/adapters/services";

const file = {
  path: "src/app.ts",
  lineCount: 1,
  hunks: [],
  isDeleted: false,
  isBinary: false,
  isNew: false,
  previousPath: null,
};

// Free-tier body puts cool-off in message, not headers.
function quotaResponse(
  retryInSeconds: number,
  model = "gemini-3.1-pro-preview",
) {
  return new Response(
    JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        message:
          "You exceeded your current quota, please check your plan and billing details. " +
          `* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 16000, model: ${model}` +
          `\nPlease retry in ${retryInSeconds}s.`,
      },
    }),
    { status: 429, headers: { "content-type": "application/json" } },
  );
}

describe("quota 429 handling", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stops walking a long fallback chain after two quota failures and defers the file", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => quotaResponse(56));
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = makeModelFactory(env)("job-x", undefined as any);

    await expect(
      service.reviewFile({
        file,
        prTitle: "Test",
        prDescription: null,
        totalLineCount: 1,
        config: {
          ...defaultRepoConfig,
          model: {
            main: "gemini-3.1-pro-preview",
            fallbacks: [
              "gemini-2.5-pro",
              "gemini-3.1-flash-lite",
              "gemini-3.5-flash-lite",
              "gemini-3.6-flash",
            ],
            size_overrides: [],
          },
        },
      }),
    ).rejects.toSatisfy(isRetryableModelError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const attempted = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      attempted.some((url) => url.includes("gemini-3.1-pro-preview")),
    ).toBe(true);
    expect(attempted.some((url) => url.includes("gemini-2.5-pro"))).toBe(true);
    // Only seeded GOOGLE_TEST_MODEL_IDS models fetch.
    expect(attempted.some((url) => url.includes("gemini-3.1-flash-lite"))).toBe(
      false,
    );
  });
});

function reviewResponse() {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok"}',
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

// Single metered head model avoids MAX_QUOTA_FAILURES_PER_FILE masking tests.
const chain = {
  ...defaultRepoConfig,
  model: {
    main: "gemini-3.1-pro-preview",
    fallbacks: ["gemini-3.1-flash-lite"],
    size_overrides: [],
  },
};

// Learns provider rate limits from 429 bodies to avoid wasted subrequests.
describe("learning a provider rate limit from its own 429", () => {
  afterEach(() => vi.restoreAllMocks());

  function googleMock(onMetered: () => Response) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      return url.includes("pro-preview") ? onMetered() : reviewResponse();
    });
  }

  it("skips a cooling-off model for subsequent files instead of re-probing it", async () => {
    const fetchMock = googleMock(() => quotaResponse(56));
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = makeModelFactory(env)("job-x", undefined as any);
    const params = {
      prTitle: "Test",
      prDescription: null,
      totalLineCount: 1,
      config: chain,
    };

    await service.reviewFile({ ...params, file });
    const afterFirst = fetchMock.mock.calls.length;
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("pro-preview")),
    ).toBe(true);

    fetchMock.mockClear();
    await service.reviewFile({
      ...params,
      file: { ...file, path: "src/second.ts" },
    });

    expect(
      fetchMock.mock.calls
        .map((c) => String(c[0]))
        .some((url) => url.includes("pro-preview")),
    ).toBe(false);
    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(afterFirst).toBeGreaterThan(1);
  });

  it("skips a model whose whole token bucket is smaller than the prompt", async () => {
    const fetchMock = googleMock(() => quotaResponse(1));
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = makeModelFactory(env)("job-x", undefined as any);
    const params = {
      prTitle: "Test",
      prDescription: null,
      totalLineCount: 1,
      config: chain,
    };

    // Teach bucket size, then let cool-off lapse.
    await service.reviewFile({ ...params, file });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Exceeds 16k tokens but fits chunk cap.
    const hugeFile = {
      ...file,
      path: "src/huge.ts",
      lineCount: 300,
      hunks: [
        {
          header: "@@ -1,300 +1,300 @@",
          lines: Array.from({ length: 300 }, (_, i) => ({
            kind: "add" as const,
            content: `const value${i} = ${"x".repeat(240)};`,
            newLineNumber: i + 1,
            position: i + 1,
          })),
        },
      ],
    };

    fetchMock.mockClear();
    await service.reviewFile({ ...params, file: hugeFile });

    expect(
      fetchMock.mock.calls
        .map((c) => String(c[0]))
        .some((url) => url.includes("pro-preview")),
    ).toBe(false);
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("carries a cool-off to the next invocation of the same job", async () => {
    const fetchMock = googleMock(() => quotaResponse(56));
    // MemoryKV mimics continuation handoff.
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const params = {
      prTitle: "Test",
      prDescription: null,
      totalLineCount: 1,
      config: chain,
    };

    const first = makeModelFactory(env)("job-continuation", undefined as any);
    await first.reviewFile({ ...params, file });
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes("pro-preview")),
    ).toBe(true);

    // Brand-new service mimics fresh invocation.
    fetchMock.mockClear();
    const next = makeModelFactory(env)("job-continuation", undefined as any);
    await next.reviewFile({
      ...params,
      file: { ...file, path: "src/second.ts" },
    });

    expect(
      fetchMock.mock.calls
        .map((c) => String(c[0]))
        .some((url) => url.includes("pro-preview")),
    ).toBe(false);
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it("keeps a cool-off scoped to its own job and model", async () => {
    const fetchMock = googleMock(() => quotaResponse(56));
    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const params = {
      prTitle: "Test",
      prDescription: null,
      totalLineCount: 1,
      config: chain,
    };

    await makeModelFactory(env)("job-a", undefined as any).reviewFile({
      ...params,
      file,
    });

    // Unrelated jobs must not inherit cool-offs.
    fetchMock.mockClear();
    await makeModelFactory(env)("job-b", undefined as any).reviewFile({
      ...params,
      file,
    });

    expect(
      fetchMock.mock.calls
        .map((c) => String(c[0]))
        .some((url) => url.includes("pro-preview")),
    ).toBe(true);
  });

  it("returns to the primary model once its cool-off has expired", async () => {
    let meteredCalls = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (!url.includes("pro-preview")) return reviewResponse();
        meteredCalls += 1;
        return meteredCalls === 1 ? quotaResponse(1) : reviewResponse();
      });

    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = makeModelFactory(env)("job-x", undefined as any);
    const params = {
      prTitle: "Test",
      prDescription: null,
      totalLineCount: 1,
      config: chain,
    };

    await service.reviewFile({ ...params, file });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    fetchMock.mockClear();
    const second = await service.reviewFile({
      ...params,
      file: { ...file, path: "src/third.ts" },
    });

    expect(second.modelUsed).toContain("pro-preview");
    expect(
      fetchMock.mock.calls
        .map((c) => String(c[0]))
        .some((url) => url.includes("pro-preview")),
    ).toBe(true);
  });
});
