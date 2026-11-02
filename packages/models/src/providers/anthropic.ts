import { logger } from "@codraoss/core/logger";
import { withTimeout } from "@codraoss/core/timeout";
import {
  ProviderRequestError,
  providerErrorMessage,
  jsonOnlyPrompts,
  type ModelResponse,
} from "../types";
import { assertPublicBaseUrl } from "../url-guard";
import { MODEL_TIMEOUT_MAX_MS, resolveOutputTokenCeiling } from "../limits";

// Fallback when the caller supplies no diff-size-aware budget. Shares the review ceiling so an
// omitting caller can never outlast the chain budget that governs everything else.
const ANTHROPIC_TIMEOUT_MS = MODEL_TIMEOUT_MAX_MS;
const ANTHROPIC_DEFAULT_OUTPUT_TOKENS = 4096;
const ANTHROPIC_MAX_OUTPUT_TOKENS = 16_384;
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

export interface AnthropicResponse {
  content?: Array<{ text?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export async function reviewWithAnthropic(
  config: {
    apiKey: string;
    baseUrl?: string | null;
    providerName: string;
    timeoutMs?: number;
  },
  model: string,
  input: {
    systemPrompt: string;
    userPrompt: string;
    outputBudgetTokens?: number;
  },
  tracker?: { incrementSubrequests(count?: number): void },
): Promise<ModelResponse> {
  logger.info(`Calling Anthropic model: ${model}`);
  assertPublicBaseUrl(config.baseUrl, config.providerName);
  const prompts = jsonOnlyPrompts(input);
  let baseUrl = config.baseUrl || DEFAULT_ANTHROPIC_BASE_URL;
  while (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const timeoutMs = config.timeoutMs ?? ANTHROPIC_TIMEOUT_MS;

  if (tracker) tracker.incrementSubrequests(1);
  const response = await withTimeout("Anthropic API", timeoutMs, (signal) =>
    fetch(`${baseUrl}/messages`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: prompts.system,
        messages: [
          { role: "user", content: prompts.user },
          { role: "assistant", content: "{" },
        ],
        max_tokens: resolveOutputTokenCeiling(
          input.outputBudgetTokens,
          ANTHROPIC_MAX_OUTPUT_TOKENS,
          ANTHROPIC_DEFAULT_OUTPUT_TOKENS,
        ),
        // 0.6 of a 0-1 scale.
        temperature: 0.6,
      }),
    }),
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new ProviderRequestError(
      config.providerName,
      response.status,
      providerErrorMessage(errorText),
    );
  }

  const data = (await response.json()) as AnthropicResponse;
  let rawText = Array.isArray(data.content)
    ? data.content
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .join("")
        .trim()
    : "";

  if (!rawText && (!data.content || data.content.length === 0)) {
    throw new Error("Anthropic provider returned an empty response.");
  }

  // Restore the '{' used to prime JSON output; Anthropic doesn't echo the prefill back.
  rawText = "{" + rawText;

  return {
    rawText,
    inputTokens: data?.usage?.input_tokens ?? 0,
    outputTokens: data?.usage?.output_tokens ?? 0,
    modelUsed: model,
    provider: config.providerName,
  };
}
