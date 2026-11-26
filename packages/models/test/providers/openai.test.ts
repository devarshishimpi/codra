import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOpenAIReasoningModel,
  reviewWithOpenAI,
  callOpenAi,
} from "../../src/providers/openai";

describe("OpenAI provider adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const input = {
    systemPrompt: "You are a code reviewer.",
    userPrompt: "Review this pull request diff.",
  };

  const dummyReviewResponse = JSON.stringify({
    choices: [
      {
        message: {
          content:
            '{"findings":[],"overall_correctness":"patch is correct","overall_explanation":"ok","overall_confidence_score":0.9}',
        },
      },
    ],
    usage: {
      prompt_tokens: 15,
      completion_tokens: 25,
    },
  });

  function mockOpenAiResponse() {
    return new Response(dummyReviewResponse, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const getRequestBody = (fetchMock: {
    mock: { calls: unknown[][] };
  }): Record<string, unknown> => {
    const calls = fetchMock.mock.calls;
    const callArgs = calls[calls.length - 1];
    const init = callArgs[1] as RequestInit;
    return JSON.parse(String(init.body));
  };

  describe("isOpenAIReasoningModel", () => {
    it("returns true for reasoning models", () => {
      const reasoningModels = [
        "o1",
        "o1-mini",
        "o1-preview",
        "o3",
        "o3-mini",
        "o4-mini",
        "gpt-6",
        "gpt-6-preview",
        "custom-reasoning",
        "deepseek-reasoning",
        "O1",
        "O3-MINI",
        "GPT-6-TURBO",
        "CUSTOM-MODEL-REASONING",
      ];

      for (const model of reasoningModels) {
        expect(
          isOpenAIReasoningModel(model),
          `expected ${model} to be recognized as reasoning model`,
        ).toBe(true);
      }
    });

    it("returns false for standard / non-reasoning models", () => {
      const nonReasoningModels = [
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-5",
        "gpt-4-turbo",
        "gpt-3.5-turbo",
        "chatgpt-4o-latest",
        "claude-3-5-sonnet",
        "gemini-2.5-flash",
      ];

      for (const model of nonReasoningModels) {
        expect(
          isOpenAIReasoningModel(model),
          `expected ${model} not to be recognized as reasoning model`,
        ).toBe(false);
      }
    });
  });

  describe("callOpenAi request body construction", () => {
    it("constructs payload correctly for reasoning models (e.g. o1)", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockOpenAiResponse());

      await callOpenAi(
        {
          apiKey: "test-api-key",
          baseUrl: "https://api.openai.com/v1",
          providerName: "OpenAI",
        },
        "o1",
        input,
      );

      const body = getRequestBody(fetchSpy);

      expect(body.model).toBe("o1");
      // Uses role: "developer" instead of "system"
      const messages = body.messages as Array<{ role: string; content: string }>;
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("developer");
      expect(messages[0].content).toContain("You are a code reviewer.");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("Review this pull request diff.");

      // Uses max_completion_tokens
      expect(body.max_completion_tokens).toBeDefined();
      expect(typeof body.max_completion_tokens).toBe("number");
      // Does not send temperature, max_tokens, or top_p
      expect(body.temperature).toBeUndefined();
      expect(body.max_tokens).toBeUndefined();
      expect(body.top_p).toBeUndefined();
      // Keeps JSON object response format
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("constructs payload correctly for o3-mini, o4-mini, and gpt-6 reasoning models", async () => {
      for (const model of ["o3-mini", "o4-mini", "gpt-6"]) {
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValueOnce(mockOpenAiResponse());

        await callOpenAi(
          {
            apiKey: "test-api-key",
            baseUrl: "https://api.openai.com/v1",
            providerName: "OpenAI",
          },
          model,
          input,
        );

        const body = getRequestBody(fetchSpy);

        expect(body.model).toBe(model);
        const messages = body.messages as Array<{ role: string; content: string }>;
        expect(messages[0].role).toBe("developer");
        expect(messages[0].content).toContain("You are a code reviewer.");
        expect(messages[1].role).toBe("user");
        expect(messages[1].content).toContain("Review this pull request diff.");
        expect(body.max_completion_tokens).toBeDefined();
        expect(body.temperature).toBeUndefined();
        expect(body.max_tokens).toBeUndefined();
        expect(body.top_p).toBeUndefined();
        vi.restoreAllMocks();
      }
    });

    it("constructs payload correctly for standard non-reasoning models (e.g. gpt-4o)", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockOpenAiResponse());

      await callOpenAi(
        {
          apiKey: "test-api-key",
          baseUrl: "https://api.openai.com/v1",
          providerName: "OpenAI",
        },
        "gpt-4o",
        input,
      );

      const body = getRequestBody(fetchSpy);

      expect(body.model).toBe("gpt-4o");
      // Uses role: "system"
      const messages = body.messages as Array<{ role: string; content: string }>;
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("You are a code reviewer.");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("Review this pull request diff.");

      // Uses max_tokens and temperature
      expect(body.max_tokens).toBeDefined();
      expect(typeof body.max_tokens).toBe("number");
      expect(body.temperature).toBeDefined();
      expect(typeof body.temperature).toBe("number");
      // Does not send max_completion_tokens
      expect(body.max_completion_tokens).toBeUndefined();
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("works with reviewWithOpenAI function directly", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockOpenAiResponse());

      await reviewWithOpenAI(
        {
          apiKey: "test-api-key",
          baseUrl: "https://api.openai.com/v1",
          providerName: "OpenAI",
        },
        "o1-mini",
        input,
      );

      const body = getRequestBody(fetchSpy);
      expect(body.model).toBe("o1-mini");
      expect(body.max_completion_tokens).toBeDefined();
      expect(body.temperature).toBeUndefined();
      expect(body.max_tokens).toBeUndefined();
      const messages = body.messages as Array<{ role: string; content: string }>;
      expect(messages[0].role).toBe("developer");
      expect(messages[0].content).toContain("You are a code reviewer.");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("Review this pull request diff.");
    });
  });
});
