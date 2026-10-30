import { afterEach, describe, expect, it, vi } from "vitest";

import { reviewWithGoogle } from "@codraoss/models/google";
import { reviewWithOpenAI } from "@codraoss/models/openai";
import {
  geminiThinkingBudgetTokens,
  OUTPUT_TOKENS_FLOOR,
} from "../../src/limits";

// The adapters send the sampling of the called model's registered profile, and keep their own defaults
// for a model the registry does not know.
describe("adapters send the model profile's sampling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const input = { systemPrompt: "system", userPrompt: "user" };
  const review =
    '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}';

  function geminiOk() {
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: review }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  function openAiOk() {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: review } }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  const bodyOf = (fetchMock: { mock: { calls: unknown[][] } }) =>
    JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));

  it("Gemini: the profile's temperature and thinking budget, no top-p or top-k", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(geminiOk());

    await reviewWithGoogle({ apiKey: "test-key" }, "gemini-3.1-flash-lite", input);

    const config = bodyOf(fetchMock).generationConfig;
    expect(config.temperature).toBe(0.7);
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 2048 });
    expect(config.topP).toBeUndefined();
    expect(config.topK).toBeUndefined();
  });

  it("Gemini without a profile: temperature 0.9 and Codra's default thinking budget", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(geminiOk());

    await reviewWithGoogle({ apiKey: "test-key" }, "gemini-unprofiled-test", input);

    const config = bodyOf(fetchMock).generationConfig;
    expect(config.temperature).toBe(0.9);
    expect(config.thinkingConfig).toEqual({
      thinkingBudget: geminiThinkingBudgetTokens(OUTPUT_TOKENS_FLOOR),
    });
  });

  it("NVIDIA Nemotron 3.5: the profile's temperature and top-p, thinking off through the chat template", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiOk());

    await reviewWithOpenAI(
      { apiKey: "test-key", baseUrl: "https://integrate.api.nvidia.com/v1", providerName: "NVIDIA" },
      "nvidia/nemotron-3.5-super-vl-120b-a12b",
      input,
    );

    const body = bodyOf(fetchMock);
    expect(body.temperature).toBe(0.6);
    expect(body.top_p).toBe(0.9);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("Z.ai GLM: the profile's temperature and top-p, thinking disabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiOk());

    await reviewWithOpenAI(
      { apiKey: "test-key", baseUrl: "https://api.z.ai/api/paas/v4", providerName: "Z.ai" },
      "glm-4.7-flash",
      input,
    );

    const body = bodyOf(fetchMock);
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("OpenAI-compatible without a profile: the endpoint's midpoint and no top-p", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiOk());

    await reviewWithOpenAI(
      { apiKey: "test-key", baseUrl: "https://integrate.api.nvidia.com/v1", providerName: "NVIDIA" },
      "vendor/unprofiled-test-model",
      input,
    );

    const body = bodyOf(fetchMock);
    expect(body.temperature).toBe(0.5);
    expect(body.top_p).toBeUndefined();
  });
});
