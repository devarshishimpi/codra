import { describe, it, expect, vi } from "vitest";
import {
  reviewWithCloudflare,
  submitCloudflareBatch,
  pollCloudflareBatch,
} from "@codraoss/models/cloudflare";

// Regression: some Workers AI models (e.g. @cf/qwen/qwen2.5-coder-32b-instruct honoring
// response_format) return `response` as an already-parsed JSON object/array rather than a string.
// extractCloudflareText used to only accept a string, discarding a good review as "empty response".

const REVIEW_JSON = {
  findings: [],
  overall_correctness: "patch is correct",
  overall_explanation: "Looks good.",
  overall_confidence_score: 0.9,
};

function envReturning(result: unknown) {
  return {
    AI: {
      async run() {
        return result;
      },
    },
  } as any;
}

const input = { systemPrompt: "sys", userPrompt: "user" };

describe("reviewWithCloudflare response extraction", () => {
  it("accepts a structured object response (parsed JSON) and passes it through verbatim", async () => {
    const res = await reviewWithCloudflare(
      envReturning({
        response: REVIEW_JSON,
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }).AI,
      "@cf/qwen/qwen2.5-coder-32b-instruct",
      input,
    );
    // Must be the real review JSON, not a synthesized "no parseable review content" fallback.
    expect(JSON.parse(res.rawText)).toMatchObject({
      overall_correctness: "patch is correct",
    });
    expect(res.rawText).not.toContain("no parseable review content");
    expect(res.inputTokens).toBe(3);
    expect(res.outputTokens).toBe(4);
  });

  it("accepts a structured object under a nested result.response", async () => {
    const res = await reviewWithCloudflare(
      envReturning({ result: { response: REVIEW_JSON } }).AI,
      "@cf/qwen/qwen2.5-coder-32b-instruct",
      input,
    );
    expect(JSON.parse(res.rawText)).toMatchObject({
      overall_explanation: "Looks good.",
    });
    expect(res.rawText).not.toContain("no parseable review content");
  });

  it("still accepts a plain string response (existing behavior)", async () => {
    const res = await reviewWithCloudflare(
      envReturning({ response: JSON.stringify(REVIEW_JSON) }).AI,
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      input,
    );
    expect(JSON.parse(res.rawText)).toMatchObject({
      overall_correctness: "patch is correct",
    });
  });

  it("throws (fails the file) instead of synthesizing a fake review when the model returns nothing usable", async () => {
    await expect(
      reviewWithCloudflare(
        envReturning({ something_unexpected: true }).AI,
        "@cf/qwen/qwen2.5-coder-32b-instruct",
        input,
      ),
    ).rejects.toThrow(/no reviewable output/i);
  });

  it("throws on a reasoning-only / token-truncated response (marks the file failed, not inconclusive)", async () => {
    const reasoningOnly = {
      choices: [
        {
          finish_reason: "length",
          message: {
            content: null,
            reasoning: "thinking, thinking, never answering...",
          },
        },
      ],
    };
    await expect(
      reviewWithCloudflare(
        envReturning(reasoningOnly).AI,
        "@cf/moonshotai/kimi-k2.6",
        input,
      ),
    ).rejects.toThrow(/no reviewable output/i);
  });
});

describe("Cloudflare async batch submit/poll", () => {
  it("submits a batch request and returns the queue request_id", async () => {
    const run = vi
      .fn()
      .mockResolvedValue({
        status: "queued",
        request_id: "req-123",
        model: "@cf/moonshotai/kimi-k2.6",
      });
    const env = { AI: { run } } as any;
    const id = await submitCloudflareBatch(
      env.AI,
      "@cf/moonshotai/kimi-k2.6",
      input,
    );
    expect(id).toBe("req-123");
    // Must send a `requests` array with queueRequest option.
    expect(run.mock.calls[0][1]).toHaveProperty("requests");
    expect(run.mock.calls[0][2]).toMatchObject({ queueRequest: true });
  });

  it("throws when the model does not return a request_id (async unsupported → caller falls back to sync)", async () => {
    const env = {
      AI: {
        async run() {
          return { response: '{"findings":[]}' };
        },
      },
    } as any;
    await expect(
      submitCloudflareBatch(env.AI, "@cf/meta/llama-3.1-8b-instruct", input),
    ).rejects.toThrow(/async queueing unsupported|did not return/i);
  });

  it("reports pending while the batch is queued or running", async () => {
    for (const status of ["queued", "running"]) {
      const env = {
        AI: {
          async run() {
            return { status, request_id: "req-1" };
          },
        },
      } as any;
      const res = await pollCloudflareBatch(
        env.AI,
        "@cf/moonshotai/kimi-k2.6",
        "req-1",
      );
      expect(res.status).toBe("pending");
    }
  });

  it("extracts the review from a completed batch (responses[] with string response)", async () => {
    const env = {
      AI: {
        async run() {
          return {
            responses: [
              {
                id: 0,
                external_reference: "src/app.ts",
                result: {
                  response: JSON.stringify(REVIEW_JSON),
                  usage: { prompt_tokens: 5, completion_tokens: 6 },
                },
              },
            ],
          };
        },
      },
    } as any;
    const res = await pollCloudflareBatch(
      env.AI,
      "@cf/moonshotai/kimi-k2.6",
      "req-1",
    );
    expect(res.status).toBe("done");
    if (res.status === "done") {
      expect(JSON.parse(res.response.rawText)).toMatchObject({
        overall_correctness: "patch is correct",
      });
      expect(res.response.inputTokens).toBe(5);
      expect(res.response.outputTokens).toBe(6);
    }
  });

  it("extracts the review from a completed batch whose entry carries an object response", async () => {
    const env = {
      AI: {
        async run() {
          return { result: { responses: [{ id: 0, response: REVIEW_JSON }] } };
        },
      },
    } as any;
    const res = await pollCloudflareBatch(
      env.AI,
      "@cf/moonshotai/kimi-k2.6",
      "req-1",
    );
    expect(res.status).toBe("done");
    if (res.status === "done") {
      expect(JSON.parse(res.response.rawText)).toMatchObject({
        overall_explanation: "Looks good.",
      });
    }
  });
});
