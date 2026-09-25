import { logger } from "@codraoss/core/logger";

import { TimeoutError } from "@codraoss/core/timeout";
import {
  ProviderRequestError,
  UnparseableModelResponseError,
  jsonOnlyPrompts,
  type ModelInput,
  type ModelResponse,
} from "../types";
import {
  MODEL_TIMEOUT_MAX_MS,
  OUTPUT_TOKENS_FLOOR,
  resolveOutputTokenCeiling,
} from "../limits";

export interface CloudflareAiBinding {
  run(model: string, args: unknown, options?: unknown): Promise<unknown>;
}

// Reasoning models under strict-JSON can burn the token budget thinking and never emit.
const CLOUDFLARE_TIMEOUT_MS = MODEL_TIMEOUT_MAX_MS;
const CLOUDFLARE_DEFAULT_OUTPUT_TOKENS = OUTPUT_TOKENS_FLOOR;
// Workers AI context windows vary widely, so this stays modest: larger `max_completion_tokens` are clamped.
const CLOUDFLARE_MAX_OUTPUT_TOKENS = 16_384;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getRecord(value: unknown, key: string): UnknownRecord | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

function getNumber(value: unknown, key: string) {
  if (!isRecord(value)) return null;
  const child = value[key];
  return typeof child === "number" ? child : null;
}

function isLocalWorkersAiBindingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes("binding ai") && normalized.includes("run remotely")
  );
}

function failUnparseable(model: string, reason: string): never {
  logger.warn(
    `Cloudflare model ${model} returned no parseable review content; failing the file review`,
    { reason },
  );
  throw new UnparseableModelResponseError(model, reason);
}

function extractMessageContent(content: unknown): string | null {
  if (isText(content)) return content.trim();

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (isText(part)) return part;
        if (isRecord(part) && isText(part.text)) return part.text;
        return "";
      })
      .join("")
      .trim();
    return text || null;
  }

  return null;
}

// `response` is a string on most models, a parsed object/array on structured-output ones; accept both or a good review is discarded as empty.
function extractResponseField(container: unknown): string | null {
  if (!isRecord(container)) return null;
  const value = container.response;
  if (isText(value)) return value.trim();
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function extractCloudflareText(result: unknown, model: string): string {
  if (isText(result)) return result.trim();
  const response = extractResponseField(result);
  if (response) return response;

  const nestedResult = getRecord(result, "result");
  const nestedResponse = extractResponseField(nestedResult);
  if (nestedResponse) return nestedResponse;

  const choices =
    isRecord(result) && Array.isArray(result.choices) ? result.choices : null;
  const choice = choices?.[0];
  const message = getRecord(choice, "message");
  const content = extractMessageContent(message?.content);
  if (content) return content;

  const finishReason = isRecord(choice)
    ? (choice.finish_reason ?? choice.stop_reason)
    : null;
  const reasoning = isText(message?.reasoning)
    ? message.reasoning
    : isText(message?.reasoning_content)
      ? message.reasoning_content
      : null;
  if (reasoning) {
    return failUnparseable(
      model,
      `reasoning-only response${finishReason ? `, finish_reason=${String(finishReason)}` : ""}`,
    );
  }

  if (finishReason) {
    return failUnparseable(model, `finish_reason=${String(finishReason)}`);
  }

  return failUnparseable(model, "empty response");
}

function extractCloudflareUsage(result: unknown) {
  const usage =
    getRecord(result, "usage") ??
    getRecord(getRecord(result, "result"), "usage");
  return {
    inputTokens: getNumber(usage, "prompt_tokens") ?? 0,
    outputTokens: getNumber(usage, "completion_tokens") ?? 0,
  };
}

// Grammar comes from CALLER.
function buildCloudflareInferenceRequest(input: ModelInput) {
  const prompts = jsonOnlyPrompts(input);
  return {
    messages: [
      { role: "system", content: prompts.system },
      { role: "user", content: prompts.user },
    ],
    max_completion_tokens: resolveOutputTokenCeiling(
      input.outputBudgetTokens,
      CLOUDFLARE_MAX_OUTPUT_TOKENS,
      CLOUDFLARE_DEFAULT_OUTPUT_TOKENS,
    ),
    ...(input.responseSchema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: input.responseSchema.name,
              strict: true,
              schema: input.responseSchema.schema,
            },
          },
        }
      : {}),
    // 0.6 on Workers AI's 0-5 scale; top_p moves with it, else pinning it low would cancel the raise.
    temperature: 0.6,
    top_p: 0.9,
  };
}

// `pending` covers both queued and running.
export type CloudflareBatchPollResult =
  { status: "pending" } | { status: "done"; response: ModelResponse };

function extractBatchStatus(result: unknown): string | null {
  if (!isRecord(result)) return null;
  const status = result.status ?? getRecord(result, "result")?.status;
  return typeof status === "string" ? status.toLowerCase() : null;
}

// Workers AI has returned several shapes here (`responses`, `result.responses`, or a bare result); probe defensively and fall back to the whole payload.
function extractBatchInnerResult(result: unknown): unknown {
  const containers = [result, isRecord(result) ? result.result : undefined];
  for (const container of containers) {
    if (!isRecord(container)) continue;
    const responses = container.responses ?? container.results;
    if (Array.isArray(responses) && responses.length > 0) {
      const first = responses[0];
      // Entries may wrap output under `result`/`response`, or be it directly.
      if (isRecord(first)) return first.result ?? first;
      return first;
    }
  }
  return result;
}

// Throws if unsupported; the caller falls back to the synchronous path.
export async function submitCloudflareBatch(
  aiBinding: CloudflareAiBinding,
  model: string,
  input: ModelInput,
  tracker?: { incrementSubrequests(count?: number): void },
): Promise<string> {
  if (tracker) tracker.incrementSubrequests(1);
  logger.info(`Submitting async batch request to Cloudflare model: ${model}`);
  const result = await aiBinding.run(
    model as any,
    { requests: [buildCloudflareInferenceRequest(input)] } as any,
    { queueRequest: true } as any,
  );

  const requestId = isRecord(result)
    ? (result.request_id ?? getRecord(result, "result")?.request_id)
    : undefined;
  if (typeof requestId !== "string" || !requestId) {
    throw new Error(
      `Cloudflare model ${model} did not return an async batch request_id (async queueing unsupported).`,
    );
  }
  return requestId;
}

export async function pollCloudflareBatch(
  aiBinding: CloudflareAiBinding,
  model: string,
  requestId: string,
  tracker?: { incrementSubrequests(count?: number): void },
  providerName = "Cloudflare",
): Promise<CloudflareBatchPollResult> {
  if (tracker) tracker.incrementSubrequests(1);
  const result = await aiBinding.run(model, { request_id: requestId });

  const status = extractBatchStatus(result);
  if (status === "queued" || status === "running") {
    return { status: "pending" };
  }

  const inner = extractBatchInnerResult(result);
  const rawText = extractCloudflareText(inner, model);
  const usage = extractCloudflareUsage(inner);
  return {
    status: "done",
    response: {
      rawText,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      modelUsed: model,
      provider: providerName,
    },
  };
}

export async function reviewWithCloudflare(
  aiBinding: CloudflareAiBinding,
  model: string,
  input: ModelInput,
  tracker?: { incrementSubrequests(count?: number): void },
  providerName = "Cloudflare",
  options?: { timeoutMs?: number },
): Promise<ModelResponse> {
  // Single attempt: retries would waste subrequests on a failing model.
  const timeoutMs = options?.timeoutMs ?? CLOUDFLARE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Promise.race only stops us awaiting; the binding's abort signal is what actually cancels the still-running subrequest.
  const controller = new AbortController();
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`Cloudflare (${model})`, timeoutMs));
    }, timeoutMs);
  });

  try {
    if (tracker) tracker.incrementSubrequests(1);

    logger.info(`Calling Cloudflare model: ${model}`);
    const startTime = Date.now();
    const runPromise = aiBinding.run(
      model,
      buildCloudflareInferenceRequest(input),
      { signal: controller.signal },
    );
    // The aborted run still settles as a rejection; a no-op handler stops it surfacing as unhandled.
    runPromise.catch(() => {});
    const result = await Promise.race([runPromise, timeoutPromise]);
    logger.info(`AI model ${model} responded in ${Date.now() - startTime}ms`);

    const usage = extractCloudflareUsage(result);
    return {
      rawText: extractCloudflareText(result, model),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      modelUsed: model,
      provider: providerName,
    };
  } catch (error) {
    if (isLocalWorkersAiBindingError(error)) {
      const message =
        "Cloudflare Workers AI is not available in local Wrangler. Run with remote bindings or deploy the Worker to test Cloudflare models.";
      logger.warn(message, { model });
      throw new ProviderRequestError(providerName, 400, message);
    }

    logger.error("Cloudflare request failed", {
      model,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
