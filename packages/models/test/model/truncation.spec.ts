import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import { reviewWithGoogle } from "@codraoss/models/google";
import { reviewWithVertex } from "@codraoss/models/vertex";
import {
  geminiThinkingBudgetTokens,
  OUTPUT_TOKENS_FLOOR,
} from "../../src/limits";

const ANSWER =
  '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}';
const THINKING = geminiThinkingBudgetTokens(OUTPUT_TOKENS_FLOOR);
const FIRST_CEILING = OUTPUT_TOKENS_FLOOR + THINKING;
const RAISED_CEILING = 2 * OUTPUT_TOKENS_FLOOR + THINKING;

function geminiResponse(finishReason: string, text: string) {
  return new Response(
    JSON.stringify({
      candidates: [
        { content: { parts: text ? [{ text }] : [] }, finishReason },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 400,
        thoughtsTokenCount: 9_826,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const PARTIAL =
  '{"findings":[{"path":"a.ts","line":1,"severity":"P1","claim_type":"bug","title":"x"';

function bodiesOf(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls.map((call) =>
    JSON.parse(String((call[1] as RequestInit).body)),
  );
}

describe("Gemini truncation handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const config = { apiKey: "key", providerName: "Google" };
  const input = {
    systemPrompt: "system",
    userPrompt: "user",
    truncationIntolerant: true,
  };

  it("re-probes once with a larger ceiling when the answer is cut off", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(geminiResponse("MAX_TOKENS", PARTIAL))
      .mockResolvedValueOnce(geminiResponse("STOP", ANSWER));

    const result = await reviewWithGoogle(config, "gemini-2.5-flash", input);

    const sent = bodiesOf(fetchMock);
    expect(sent).toHaveLength(2);
    expect(sent[0].generationConfig.maxOutputTokens).toBe(FIRST_CEILING);
    expect(sent[1].generationConfig.maxOutputTokens).toBe(RAISED_CEILING);
    expect(sent[1].generationConfig.thinkingConfig).toEqual({
      thinkingBudget: THINKING,
    });
    expect(result.rawText).toContain("patch is correct");
  });

  it("re-probes at most once, then fails with the partial text attached", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => geminiResponse("MAX_TOKENS", PARTIAL));

    const error = await reviewWithGoogle(
      config,
      "gemini-2.5-flash",
      input,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /no reviewable output.*MAX_TOKENS/i,
    );
    expect(
      (error as { partialResponse?: { rawText: string; outputTokens: number } })
        .partialResponse,
    ).toMatchObject({
      rawText: PARTIAL,
      outputTokens: 400,
      modelUsed: "gemini-2.5-flash",
    });
    expect(bodiesOf(fetchMock)).toHaveLength(2);
  });

  it("leaves a truncated answer alone for callers that can use a partial one", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(geminiResponse("MAX_TOKENS", PARTIAL));

    const result = await reviewWithGoogle(config, "gemini-2.5-flash", {
      systemPrompt: "s",
      userPrompt: "u",
    });

    expect(result.rawText).toBe(PARTIAL);
    expect(bodiesOf(fetchMock)).toHaveLength(1);
  });

  it("does not re-probe a non-MAX_TOKENS stop reason", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(geminiResponse("SAFETY", ""));

    await expect(
      reviewWithGoogle(config, "gemini-2.5-flash", input),
    ).rejects.toThrow(/finishReason=SAFETY/);
    expect(bodiesOf(fetchMock)).toHaveLength(1);
  });

  it("skips the re-probe when the remaining time cannot deliver the extra tokens", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(geminiResponse("MAX_TOKENS", PARTIAL));

    await expect(
      reviewWithGoogle(
        { ...config, timeoutMs: 1_000 },
        "gemini-2.5-flash",
        input,
      ),
    ).rejects.toThrow(/no reviewable output/i);
    expect(bodiesOf(fetchMock)).toHaveLength(1);
  });
});

describe("Vertex truncation handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  // Tokens are cached per client_email for the isolate's life; unique accounts avoid cross-test reuse.
  let account = 0;
  function freshConfig() {
    account += 1;
    return {
      apiKey: JSON.stringify({
        client_email:
          "codra-trunc-" + account + "@example.iam.gserviceaccount.com",
        private_key: privateKey,
      }),
      baseUrl:
        "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1",
      providerName: "Google Vertex AI",
    };
  }

  function tokenOk() {
    return new Response(
      JSON.stringify({ access_token: "token", expires_in: 3600 }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }

  function generateBodies(fetchMock: { mock: { calls: unknown[][] } }) {
    return fetchMock.mock.calls
      .filter((call) => String(call[0]).includes(":generateContent"))
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
  }

  const input = {
    systemPrompt: "system",
    userPrompt: "user",
    truncationIntolerant: true,
  };

  it("re-probes once with a larger ceiling and keeps the thinking budget", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(geminiResponse("MAX_TOKENS", PARTIAL))
      .mockResolvedValueOnce(geminiResponse("STOP", ANSWER));

    const result = await reviewWithVertex(
      freshConfig(),
      "gemini-2.5-flash",
      input,
    );

    const sent = generateBodies(fetchMock);
    expect(sent).toHaveLength(2);
    expect(sent[0].generationConfig.maxOutputTokens).toBe(FIRST_CEILING);
    expect(sent[1].generationConfig.maxOutputTokens).toBe(RAISED_CEILING);
    expect(sent[1].generationConfig.thinkingConfig).toEqual({
      thinkingBudget: THINKING,
    });
    expect(result.rawText).toContain("patch is correct");
  });

  it("fails with the partial text attached when the re-probe is still cut off", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockImplementation(async () => geminiResponse("MAX_TOKENS", PARTIAL));

    const error = await reviewWithVertex(
      freshConfig(),
      "gemini-2.5-flash",
      input,
    ).catch((e: unknown) => e);

    expect((error as Error).message).toMatch(
      /no reviewable output.*MAX_TOKENS/i,
    );
    expect(
      (error as { partialResponse?: { rawText: string } }).partialResponse,
    ).toMatchObject({ rawText: PARTIAL, provider: "Google Vertex AI" });
    expect(generateBodies(fetchMock)).toHaveLength(2);
  });

  it("leaves a truncated answer alone for callers that can use a partial one", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(geminiResponse("MAX_TOKENS", PARTIAL));

    const result = await reviewWithVertex(freshConfig(), "gemini-2.5-flash", {
      systemPrompt: "s",
      userPrompt: "u",
    });

    expect(result.rawText).toBe(PARTIAL);
    expect(generateBodies(fetchMock)).toHaveLength(1);
  });
});
