import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import { reviewWithVertex } from "@codraoss/models/vertex";
import {
  geminiThinkingBudgetTokens,
  OUTPUT_TOKENS_FLOOR,
} from "../../src/limits";

describe("reviewWithVertex: thinking budget and the rejection latch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Vertex signs a JWT with the key, so it must be a genuine PKCS8 key, not a placeholder string.
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
        client_email: `codra-${account}@example.iam.gserviceaccount.com`,
        private_key: privateKey,
      }),
      baseUrl:
        "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1",
      providerName: "Google Vertex AI",
    };
  }

  const input = { systemPrompt: "system", userPrompt: "user" };

  function tokenOk() {
    return new Response(
      JSON.stringify({ access_token: "token", expires_in: 3600 }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }

  function vertexOk(
    text = '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}',
  ) {
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 5,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  function vertex400(message: string) {
    return new Response(
      JSON.stringify({
        error: { code: 400, status: "INVALID_ARGUMENT", message },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  function vertex429() {
    return new Response(
      JSON.stringify({
        error: {
          code: 429,
          message: "Resource exhausted. Please try again later.",
        },
      }),
      { status: 429, headers: { "content-type": "application/json" } },
    );
  }

  function generateBodies(fetchMock: { mock: { calls: unknown[][] } }) {
    return fetchMock.mock.calls
      .filter((call) => String(call[0]).includes(":generateContent"))
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
  }

  it("sends a bounded thinking budget and reserves room for it in maxOutputTokens", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(vertexOk());

    await reviewWithVertex(freshConfig(), "gemini-2.5-flash", input);

    const [body] = generateBodies(fetchMock);
    const expectedThinking = geminiThinkingBudgetTokens(OUTPUT_TOKENS_FLOOR);

    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: expectedThinking,
    });
    expect(body.generationConfig.maxOutputTokens).toBe(
      OUTPUT_TOKENS_FLOOR + expectedThinking,
    );
  });

  it("scales the budget with the requested output and keeps thinking a minority of the ceiling", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(vertexOk());

    await reviewWithVertex(freshConfig(), "gemini-2.5-pro", {
      ...input,
      outputBudgetTokens: 32_768,
    });

    const [body] = generateBodies(fetchMock);
    const thinking = body.generationConfig.thinkingConfig.thinkingBudget;

    expect(thinking).toBe(geminiThinkingBudgetTokens(32_768));
    expect(thinking).toBeGreaterThanOrEqual(1_024);
    expect(thinking).toBeLessThan(body.generationConfig.maxOutputTokens / 3);
    expect(body.generationConfig.maxOutputTokens).toBe(32_768 + thinking);
  });

  it("drops thinkingConfig and resends once when the model refuses it", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(
        vertex400(
          "Unable to submit request because thinking is not supported by this model.",
        ),
      )
      .mockResolvedValueOnce(vertexOk());

    const result = await reviewWithVertex(
      freshConfig(),
      "gemini-2.5-flash",
      input,
    );

    const bodies = generateBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].generationConfig.thinkingConfig).toBeDefined();
    expect(bodies[1].generationConfig.thinkingConfig).toBeUndefined();
    expect(bodies[1].generationConfig.maxOutputTokens).toBe(
      bodies[0].generationConfig.maxOutputTokens,
    );
    expect(result.rawText).toContain("patch is correct");
  });

  it("latches the refusal so a second failure is not retried again", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(vertex400("thinking is not supported"))
      .mockResolvedValueOnce(vertex400("thinking is not supported"));

    await expect(
      reviewWithVertex(freshConfig(), "gemini-2.5-flash", input),
    ).rejects.toThrow(/400/);
    expect(generateBodies(fetchMock)).toHaveLength(2);
  });

  it("does not treat an unrelated 400 as a thinking rejection", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(
        vertex400("Request payload size exceeds the limit."),
      );

    await expect(
      reviewWithVertex(freshConfig(), "gemini-2.5-flash", input),
    ).rejects.toThrow(/payload size/);
    expect(generateBodies(fetchMock)).toHaveLength(1);
  });

  it("still resends on a 429 after the thinking latch has fired", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(vertex400("thinking is not supported"))
      .mockResolvedValueOnce(vertex429())
      .mockResolvedValueOnce(vertexOk());

    const result = await reviewWithVertex(
      freshConfig(),
      "gemini-2.5-flash",
      input,
    );

    const bodies = generateBodies(fetchMock);
    expect(bodies).toHaveLength(3);
    expect(bodies[1].generationConfig.thinkingConfig).toBeUndefined();
    expect(bodies[2].generationConfig.thinkingConfig).toBeUndefined();
    expect(result.rawText).toContain("patch is correct");
  }, 20_000);

  it("resends an unchanged request on a plain 429", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(vertex429())
      .mockResolvedValueOnce(vertexOk());

    await reviewWithVertex(freshConfig(), "gemini-2.5-flash", input);

    const bodies = generateBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
  }, 20_000);

  it("fails rather than returning nothing when the budget is spent before any answer", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [] }, finishReason: "MAX_TOKENS" },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 0,
              thoughtsTokenCount: 9_826,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    await expect(
      reviewWithVertex(freshConfig(), "gemini-2.5-flash", input),
    ).rejects.toThrow(/no reviewable output.*MAX_TOKENS/i);
  });

  it("reports reasoning spend in usage so a truncation can be attributed", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(vertexOk());

    const result = await reviewWithVertex(
      freshConfig(),
      "gemini-2.5-flash",
      input,
    );

    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(20);
    expect(result.modelUsed).toBe("gemini-2.5-flash");
  });
});
