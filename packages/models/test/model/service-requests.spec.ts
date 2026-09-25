import { afterEach, describe, expect, it } from "vitest";

import { reviewWithCloudflare } from "@codraoss/models/cloudflare";
import { reviewWithGoogle } from "@codraoss/models/google";

import {
  buildBatchReviewResponseSchema,
  buildReviewResponseSchema,
} from "@codraoss/core/prompts/file-review";
import { VERIFY_RESPONSE_SCHEMA } from "@codraoss/core/prompts/verify";
import {
  createTestEnv,
  saveTestProviderApiKey,
  createTestModelRunner,
} from "../../../../test/helpers";

describe("ModelRunner: request shape and response handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails (throws) on a Cloudflare reasoning-only response instead of faking an inconclusive review", async () => {
    const env = createTestEnv({
      AI: {
        async run() {
          return {
            choices: [
              {
                message: {
                  content: null,
                  reasoning:
                    "Long reasoning that consumed the completion budget.",
                },
                finish_reason: "length",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 4096 },
          };
        },
      } as any,
    });

    // Nothing was reviewed, so this must surface as a failure, not an "inconclusive" pass.
    await expect(
      reviewWithCloudflare(env.AI, "@cf/moonshotai/kimi-k2.6", {
        systemPrompt: "system",
        userPrompt: "user",
      }),
    ).rejects.toThrow(/no reviewable output.*reasoning-only/i);
  });

  it("throws when Cloudflare final content is missing (does not parse reasoning as review JSON)", async () => {
    const env = createTestEnv({
      AI: {
        async run() {
          return {
            choices: [
              {
                message: {
                  content: null,
                  reasoning:
                    'Reasoning mentioned an object like {"foo":"bar"} but never produced final JSON.',
                },
                finish_reason: "length",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 8192 },
          };
        },
      } as any,
    });

    await expect(
      reviewWithCloudflare(env.AI, "@cf/zai-org/glm-4.7-flash", {
        systemPrompt: "system",
        userPrompt: "user",
      }),
    ).rejects.toThrow(/no reviewable output/i);
  });

  // Per-call: forcing the file-review schema onto the verify pass made it unsatisfiable.

  it("honors a non-review schema, so the verify pass is not forced to emit a file review", async () => {
    let inputs: any;
    const env = createTestEnv({
      AI: {
        async run(_model: string, request: any) {
          inputs = request;
          return {
            choices: [{ message: { content: '{"results":[]}' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          };
        },
      } as any,
    });

    await reviewWithCloudflare(env.AI, "@cf/zai-org/glm-4.7-flash", {
      systemPrompt: "system",
      userPrompt: "user",
      responseSchema: VERIFY_RESPONSE_SCHEMA as any,
    });

    expect(inputs.response_format.json_schema.name).toBe(
      "codra_verify_findings",
    );
    expect(
      inputs.response_format.json_schema.schema.properties.results,
    ).toBeDefined();
  });

  // The adapter's input type once omitted `responseSchema`, so callers' grammars were dropped.
  describe("Gemini constrained decoding", () => {
    function geminiOk() {
      return new Response(
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
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    // Last call, not first: captures accumulate within a test, so `calls[0]` is the earliest.
    async function captureGeminiBody(input: any) {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(geminiOk());
      await reviewWithGoogle(
        { apiKey: "test-key" },
        "gemini-3.1-pro-preview",
        input,
      );
      return JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    }

    // Enumerated, not `toBeUndefined()`, which would pass on a misspelled field name.
    const schemaKeys = (body: any) =>
      Object.keys(body.generationConfig).filter((key) => /schema/i.test(key));

    it("sends the caller's grammar as responseJsonSchema, or none at all", async () => {
      const review = await captureGeminiBody({
        systemPrompt: "system",
        userPrompt: "user",
        responseSchema: buildReviewResponseSchema(10),
      });
      expect(schemaKeys(review)).toEqual(["responseJsonSchema"]);
      expect(
        review.generationConfig.responseJsonSchema.properties.findings.maxItems,
      ).toBe(10);
      expect(review.generationConfig.responseMimeType).toBe("application/json");
      // No `outputBudgetTokens` on this input, so the adapter's own default answer budget applies -- and
      // the bounded thinking budget is added ON TOP of it, never carved out of it.
      expect(review.generationConfig.thinkingConfig.thinkingBudget).toBe(2048);
      expect(review.generationConfig.maxOutputTokens).toBe(8192 + 2048);

      // Per-call, not hardcoded: forcing the review grammar onto the verify pass made it unsatisfiable.
      const verify = await captureGeminiBody({
        systemPrompt: "system",
        userPrompt: "user",
        responseSchema: VERIFY_RESPONSE_SCHEMA as any,
      });
      expect(
        verify.generationConfig.responseJsonSchema.properties.results,
      ).toBeDefined();
      expect(
        verify.generationConfig.responseJsonSchema.properties.findings,
      ).toBeUndefined();

      // The summary path passes no grammar and must keep working unconstrained.
      const none = await captureGeminiBody({
        systemPrompt: "system",
        userPrompt: "user",
      });
      expect(schemaKeys(none)).toEqual([]);
      expect(none.generationConfig.responseMimeType).toBe("application/json");
    });

    it("memoizes a refused grammar per grammar, not per endpoint", async () => {
      // Refusing only the batched grammar makes both the memo and its grammar-keying observable.
      const sent: any[] = [];
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (_url, init) => {
          const schema = JSON.parse(String(init?.body)).generationConfig
            .responseJsonSchema;
          sent.push(schema);
          return schema?.properties?.files
            ? new Response(
                JSON.stringify({
                  error: {
                    code: 400,
                    status: "INVALID_ARGUMENT",
                    message: 'Unknown name "responseJsonSchema".',
                  },
                }),
                {
                  status: 400,
                  headers: { "content-type": "application/json" },
                },
              )
            : geminiOk();
        });

      const env = createTestEnv();
      await saveTestProviderApiKey(env);
      const service = createTestModelRunner(env);
      const call = (responseSchema: any) =>
        (service as any).callModel("gemini-3.1-pro-preview", {
          systemPrompt: "system",
          userPrompt: "user",
          responseSchema,
        });

      const batch = await call(buildBatchReviewResponseSchema(10, 4));
      const batchAgain = await call(buildBatchReviewResponseSchema(10, 4));
      const review = await call(buildReviewResponseSchema(10));

      expect(batch.degraded).toBe("schema-dropped");
      // Not degraded: the memo stripped the grammar before the call, so nothing was attempted.
      expect(batchAgain.degraded).toBeUndefined();
      expect(review.degraded).toBeUndefined();
      // probe + retry, one schemaless call, then the review grammar still attempted.
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(sent.filter((schema) => schema?.properties?.files)).toHaveLength(
        1,
      );
      expect(
        sent.filter((schema) => schema?.properties?.findings),
      ).toHaveLength(1);
    });
  });
});
