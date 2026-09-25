import { afterEach, describe, expect, it, vi } from "vitest";

import { reviewWithGoogle } from "@codraoss/models/google";
import { buildReviewResponseSchema } from "@codraoss/core/prompts/file-review";
import {
  createTestEnv,
  saveTestProviderApiKey,
  createTestModelRunner,
} from "../../../../test/helpers";
import { defaultRepoConfig } from "@codraoss/schema";

// Split out of service-retries.spec.ts: a non-transient 400 gets its own ladder rung here.
describe("ModelRunner: response-grammar rejection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  function gemini400(message: string) {
    return new Response(
      JSON.stringify({
        error: { code: 400, status: "INVALID_ARGUMENT", message },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  const withGrammar = {
    systemPrompt: "system",
    userPrompt: "user",
    responseSchema: buildReviewResponseSchema(10),
  };

  // A bare "invalid argument" with no details is Google's ACTUAL wording for some feature rejections
  // -- observed in production on gemini-3.x-lite, where the identical prompt succeeds once the grammar
  // is stripped. So an unexplained 400 gets a bounded probe ladder: retry without the grammar, then
  // without the thinking budget, then fail for real. Refusing to probe (one earlier iteration of this
  // code) burnt both lite models on every such file; probing on ANY 400 (the iteration before that)
  // let one unrelated 400 latch the model into unconstrained mode for the whole job.
  it("probes an unexplained 400 by stripping the grammar, then the thinking budget", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(gemini400("Request contains an invalid argument."))
      .mockResolvedValueOnce(gemini400("Request contains an invalid argument."))
      .mockResolvedValueOnce(geminiOk());

    const response = await reviewWithGoogle(
      { apiKey: "test-key" },
      "gemini-3.1-flash-lite",
      withGrammar,
    );

    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)),
    );
    expect(bodies).toHaveLength(3);
    expect(bodies[0].generationConfig.responseJsonSchema).toBeDefined();
    expect(bodies[0].generationConfig.thinkingConfig).toBeDefined();
    // First probe: grammar off, thinking still on.
    expect(bodies[1].generationConfig.responseJsonSchema).toBeUndefined();
    expect(bodies[1].generationConfig.thinkingConfig).toBeDefined();
    // Second probe: both off.
    expect(bodies[2].generationConfig.responseJsonSchema).toBeUndefined();
    expect(bodies[2].generationConfig.thinkingConfig).toBeUndefined();
    // Heuristic, so marked apart from a confident rejection.
    expect(response.degraded).toBe("schema-dropped-catchall");
  });

  it("fails without latching when the probes do not help", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        gemini400("Request contains an invalid argument."),
      );

    const error = await reviewWithGoogle(
      { apiKey: "test-key" },
      "gemini-3.1-flash-lite",
      withGrammar,
    ).catch((e: unknown) => e);

    expect((error as Error).message).toMatch(/400/);
    // Full attempt + two probes, then done -- the ladder is bounded by its own latches.
    expect(fetchMock.mock.calls.length).toBe(3);
    // NOT marked schema-dropped: the probe failed too, so it proved nothing about the grammar, and
    // this flag is what latches the model into unconstrained mode for the rest of the job.
    expect(
      (error as { schemaDropped?: boolean }).schemaDropped,
    ).toBeUndefined();
  });

  it("leaves a 400 that is not invalid-argument-shaped alone", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        gemini400("API key not valid. Please pass a valid API key."),
      );

    await expect(
      reviewWithGoogle(
        { apiKey: "test-key" },
        "gemini-3.1-flash-lite",
        withGrammar,
      ),
    ).rejects.toThrow(/400/);
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  // The realistic shape of a grammar rejection: the message is the useless generic one, and the
  // actionable text arrives via error.details.
  it("drops the grammar when the flattened detail names the response format", async () => {
    const withDetails = () =>
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: "Request contains an invalid argument.",
            details: [
              {
                description:
                  "Invalid value at generation_config.response_json_schema",
              },
            ],
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(withDetails())
      .mockResolvedValueOnce(geminiOk());

    const response = await reviewWithGoogle(
      { apiKey: "test-key" },
      "gemini-3.1-flash-lite",
      withGrammar,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    );
    expect(retryBody.generationConfig.responseJsonSchema).toBeUndefined();
    expect(retryBody.generationConfig.responseMimeType).toBe(
      "application/json",
    );
    expect(response.rawText).toContain('"findings"');
    // Named confidently, so the marker is the plain one.
    expect(response.degraded).toBe("schema-dropped");
  });

  // Kept for the ambiguous middle: enough to act on, not enough to be sure. The distinct marker is what
  // makes the heuristic's real hit rate answerable from `file_reviews.degraded` instead of guessed at.
  it("marks a heuristic grammar drop apart from a confident one", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        gemini400(
          "Request contains an invalid argument. too many states for serving",
        ),
      )
      .mockResolvedValueOnce(geminiOk());

    const response = await reviewWithGoogle(
      { apiKey: "test-key" },
      "gemini-3.1-flash-lite",
      withGrammar,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    );
    expect(retryBody.generationConfig.responseJsonSchema).toBeUndefined();
    expect(response.degraded).toBe("schema-dropped-catchall");
  });

  it("drops the grammar and retries once when Gemini rejects responseJsonSchema", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        gemini400(
          "Unknown name \"responseJsonSchema\" at 'generation_config': Cannot find field.",
        ),
      )
      .mockResolvedValueOnce(geminiOk());

    const response = await reviewWithGoogle(
      { apiKey: "test-key" },
      "gemini-3.1-pro-preview",
      withGrammar,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).generationConfig
        .responseJsonSchema,
    ).toBeDefined();
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).generationConfig
        .responseJsonSchema,
    ).toBeUndefined();
    expect(response.rawText).toContain('"findings"');
    // Preflight ("Test connection") depends on this surfacing.
    expect(response.degraded).toBe("schema-dropped");

    // Probe must not fire on an unrelated 400, nor when there was no grammar to drop.
    for (const [message, input] of [
      ["API key not valid. Please pass a valid API key.", withGrammar],
      [
        "Invalid value at generation_config.schema.",
        { systemPrompt: "system", userPrompt: "user" },
      ],
    ] as Array<[string, any]>) {
      vi.restoreAllMocks();
      const guarded = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(gemini400(message));
      await expect(
        reviewWithGoogle(
          { apiKey: "test-key" },
          "gemini-3.1-pro-preview",
          input,
        ),
      ).rejects.toThrow(/400/);
      expect(guarded).toHaveBeenCalledTimes(1);
    }
  });

  // Latch used to set only when the schema-less retry succeeded; a later 429 would re-probe every call.
  it("latches the grammar off even when the schema-less retry itself fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      // Not a 429 deliberately: that would cool the model and skip call 2, hiding whether the latch held.
      .mockResolvedValueOnce(
        gemini400(
          "Unknown name \"responseJsonSchema\" at 'generation_config'.",
        ),
      )
      .mockResolvedValueOnce(
        gemini400("API key not valid. Please pass a valid API key."),
      )
      .mockResolvedValue(geminiOk());

    const env = createTestEnv();
    await saveTestProviderApiKey(env);
    const service = createTestModelRunner(env);
    const params = {
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
          fallbacks: [],
          size_overrides: [],
        },
      },
      totalLineCount: 1,
    };

    await expect(service.reviewFile(params)).rejects.toThrow();
    const callsAfterFirstReview = fetchMock.mock.calls.length;

    await service.reviewFile(params);

    // The second review goes straight out without the grammar: no re-probe, no wasted 400.
    const firstCallOfSecondReview = fetchMock.mock.calls[callsAfterFirstReview];
    expect(
      JSON.parse(String(firstCallOfSecondReview?.[1]?.body)).generationConfig
        .responseJsonSchema,
    ).toBeUndefined();
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstReview + 1);
  });

  // Gemini 3.x puts the real reason in error.details; without reading it this looked like an unrelated 400.
  it("reads the rejection reason out of error.details, not just the message", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: "Request contains an invalid argument.",
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.BadRequest",
                  fieldViolations: [
                    {
                      description:
                        "The specified schema produces a constraint that has too many states for serving.",
                    },
                  ],
                },
              ],
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(geminiOk());

    const response = await reviewWithGoogle(
      { apiKey: "test-key" },
      "gemini-3.1-pro-preview",
      withGrammar,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).generationConfig
        .responseJsonSchema,
    ).toBeUndefined();
    expect(response.degraded).toBe("schema-dropped");
  });

  it("gives the attempt back for the probe, but only once", async () => {
    // Without the give-back, a ladder spent on 5xx could never drop the schema.
    const gemini500 = () =>
      new Response(
        JSON.stringify({
          error: { code: 500, message: "Internal error encountered." },
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    const ladderSpent = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(gemini500())
      .mockResolvedValueOnce(gemini500())
      .mockResolvedValueOnce(
        gemini400(
          "Unknown name \"responseJsonSchema\" at 'generation_config'.",
        ),
      )
      .mockResolvedValueOnce(geminiOk());

    const response = await reviewWithGoogle(
      { apiKey: "test-key" },
      "gemini-3.1-pro-preview",
      withGrammar,
    );

    expect(ladderSpent).toHaveBeenCalledTimes(4);
    expect(
      JSON.parse(String(ladderSpent.mock.calls[3]?.[1]?.body)).generationConfig
        .responseJsonSchema,
    ).toBeUndefined();
    expect(response.degraded).toBe("schema-dropped");

    // mockImplementation: a retried call can't reread one Response body.
    vi.restoreAllMocks();
    const persistent = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        gemini400(
          'Invalid JSON payload received. Unknown name "responseJsonSchema".',
        ),
      );

    await expect(
      reviewWithGoogle(
        { apiKey: "test-key" },
        "gemini-3.1-pro-preview",
        withGrammar,
      ),
    ).rejects.toThrow(/400/);

    expect(persistent).toHaveBeenCalledTimes(2);
  });
});
