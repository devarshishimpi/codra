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
import { profileSampling } from "./profile-sampling";

const OPENAI_TIMEOUT_MS = MODEL_TIMEOUT_MAX_MS;
const OPENAI_DEFAULT_OUTPUT_TOKENS = 4096;
const OPENAI_MAX_OUTPUT_TOKENS = 16_384;

export interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
      reasoning_content?: string;
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

function resolveOpenAiEndpointTemperature(baseUrl: string, model: string): number {
  const lowerUrl = baseUrl.toLowerCase();
  const lowerModel = model.toLowerCase();

  // Mistral AI native scale: 0.0 to 1.5. Midpoint is 0.75.
  if (lowerUrl.includes("mistral.ai") || lowerModel.includes("codestral") || lowerModel.includes("ministral")) {
    return 0.75;
  }

  // NVIDIA NIM / Build native scale: 0.0 to 1.0. Midpoint is 0.5.
  if (lowerUrl.includes("nvidia.com") || lowerUrl.includes("integrate.api.nvidia")) {
    return 0.5;
  }

  // Z.ai / GLM native scale: 0.0 to 1.0. Midpoint is 0.5.
  if (lowerUrl.includes("z.ai") || lowerUrl.includes("bigmodel.cn")) {
    return 0.5;
  }

  // Standard OpenAI / Azure 0.0 to 2.0 scale. Official midpoint is 1.0.
  return 1.0;
}

function extractOpenAiText(data: OpenAIResponse) {
  const choice = data?.choices?.[0];
  const messageContent = choice?.message?.content;
  if (typeof messageContent === "string" && messageContent.trim()) {
    return messageContent.trim();
  }
  if (Array.isArray(messageContent)) {
    const text = messageContent
      .filter((part) => part?.type === "text" || typeof part?.text === "string")
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  const reasoningContent = choice?.message?.reasoning_content;
  if (typeof reasoningContent === "string" && reasoningContent.trim()) {
    return reasoningContent.trim();
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
  // The model's registered profile sets sampling; without one, the endpoint's own midpoint.
  const sampling = profileSampling(model);
  const temperature =
    sampling?.temperature ?? resolveOpenAiEndpointTemperature(baseUrl, model);

  const lowerUrl = baseUrl.toLowerCase();
  const lowerModel = model.toLowerCase();
  const effectiveCeiling =
    lowerUrl.includes("nvidia.com") || lowerModel.includes("nemotron")
      ? Math.max(outputCeiling, 2048)
      : outputCeiling;

  const bodyPayload: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: prompts.system },
      { role: "user", content: prompts.user },
    ],
    temperature,
    ...(sampling?.topP !== undefined ? { top_p: sampling.topP } : {}),
    max_tokens: effectiveCeiling,
    response_format: { type: "json_object" },
  };

  if (lowerUrl.includes("z.ai") || lowerUrl.includes("bigmodel.cn")) {
    bodyPayload.thinking = { type: "disabled" };
  }
  // A profile with thinking off: Step-5 takes the same switch as GLM, and NVIDIA serves Nemotron 3.5's
  // reasoning toggle only through the chat template (left on, it can spend every token thinking).
  if (sampling?.thinkingBudget === "off") {
    if (lowerModel.includes("step-5")) bodyPayload.thinking = { type: "disabled" };
    if (lowerModel.includes("nemotron-3.5")) {
      bodyPayload.chat_template_kwargs = { enable_thinking: false };
    }
  }

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoffMs = 1500 * attempt + Math.floor(Math.random() * 500);
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    if (tracker) tracker.incrementSubrequests(1);
    try {
      const response = await withTimeout("OpenAI API", timeoutMs, (signal) =>
        fetch(url, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify(bodyPayload),
        }),
      );

      if (response.status === 429 || response.status === 503) {
        const errorText = await response.text();
        lastError = new ProviderRequestError(
          config.providerName,
          response.status,
          providerErrorMessage(errorText),
        );
        if (attempt < maxRetries) {
          logger.warn(`OpenAI provider ${config.providerName} returned ${response.status}; retrying (attempt ${attempt + 1}/${maxRetries})...`);
          continue;
        }
        throw lastError;
      }

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
    } catch (e: unknown) {
      if (attempt < maxRetries && (e instanceof TypeError || (e instanceof Error && e.message.includes("fetch failed")))) {
        lastError = e instanceof Error ? e : new Error(String(e));
        continue;
      }
      throw e;
    }
  }

  throw lastError ?? new Error("OpenAI request failed after retries.");
}
