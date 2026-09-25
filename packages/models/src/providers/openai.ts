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

const OPENAI_TIMEOUT_MS = MODEL_TIMEOUT_MAX_MS;
const OPENAI_DEFAULT_OUTPUT_TOKENS = 4096;
const OPENAI_MAX_OUTPUT_TOKENS = 16_384;

export interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
  output_text?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

function extractOpenAiText(data: OpenAIResponse) {
  const messageContent = data?.choices?.[0]?.message?.content;
  if (typeof messageContent === "string") return messageContent.trim();
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  const outputText = data?.output_text;
  if (typeof outputText === "string") return outputText.trim();
  return "";
}

export async function reviewWithOpenAI(
  config: {
    apiKey: string | null;
    baseUrl: string;
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
  logger.info(`Calling OpenAI-format model: ${model}`);
  const timeoutMs = config.timeoutMs ?? OPENAI_TIMEOUT_MS;
  const outputCeiling = resolveOutputTokenCeiling(
    input.outputBudgetTokens,
    OPENAI_MAX_OUTPUT_TOKENS,
    OPENAI_DEFAULT_OUTPUT_TOKENS,
  );

  assertPublicBaseUrl(config.baseUrl, config.providerName);
  const prompts = jsonOnlyPrompts(input);

  let baseUrl = config.baseUrl;
  while (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }
  const url = `${baseUrl}/chat/completions`;

  if (tracker) tracker.incrementSubrequests(1);
  const response = await withTimeout("OpenAI API", timeoutMs, (signal) =>
    fetch(url, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompts.system },
          { role: "user", content: prompts.user },
        ],
        // 0.9 of a 0-2 scale.
        temperature: 0.9,
        max_tokens: outputCeiling,
        response_format: { type: "json_object" },
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

  const data = (await response.json()) as OpenAIResponse;
  const rawText = extractOpenAiText(data);
  if (!rawText) {
    throw new Error("OpenAI provider returned an empty response.");
  }

  return {
    rawText,
    inputTokens: data?.usage?.prompt_tokens ?? data?.usage?.input_tokens ?? 0,
    outputTokens:
      data?.usage?.completion_tokens ?? data?.usage?.output_tokens ?? 0,
    modelUsed: model,
    provider: config.providerName,
  };
}
