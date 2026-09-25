import type { LlmApiFormat } from "@codraoss/schema";
import { withTimeout } from "@codraoss/core/timeout";
import { assertPublicBaseUrl } from "./url-guard";

const MODEL_LIST_TIMEOUT_MS = 8_000;
const ERROR_BODY_LIMIT = 500;
const CLOUDFLARE_TEXT_GENERATION_MODELS = [
  "@cf/moonshotai/kimi-k2.6",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/openai/gpt-oss-120b",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/moonshotai/kimi-k2.5",
  "@cf/ibm/granite-4.0-h-micro",
  "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
  "@cf/openai/gpt-oss-20b",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/google/gemma-3-12b-it",
  "@cf/mistral/mistral-small-3.1-24b-instruct",
  "@cf/qwen/qwq-32b",
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/meta/llama-guard-3-8b",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.2-1b-instruct",
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-3.2-11b-vision-instruct",
  "@cf/meta/llama-3.1-8b-instruct-awq",
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/meta-llama/meta-llama-3-8b-instruct",
  "@cf/meta/llama-3-8b-instruct-awq",
  "@cf/meta/llama-3-8b-instruct",
  "@cf/mistral/mistral-7b-instruct-v0.2",
  "@cf/google/gemma-7b-it-lora",
  "@cf/google/gemma-2b-it-lora",
  "@cf/meta-llama/llama-2-7b-chat-hf-lora",
  "@cf/google/gemma-7b-it",
  "@cf/nexusflow/starling-lm-7b-beta",
  "@cf/nousresearch/hermes-2-pro-mistral-7b",
  "@cf/mistral/mistral-7b-instruct-v0.2-lora",
  "@cf/qwen/qwen1.5-1.8b-chat",
  "@cf/microsoft/phi-2",
  "@cf/tinyllama/tinyllama-1.1b-chat-v1.0",
  "@cf/qwen/qwen1.5-14b-chat-awq",
  "@cf/qwen/qwen1.5-7b-chat-awq",
  "@cf/qwen/qwen1.5-0.5b-chat",
  "@cf/thebloke/discolm-german-7b-v1-awq",
  "@cf/tiiuae/falcon-7b-instruct",
  "@cf/openchat/openchat-3.5-0106",
  "@cf/defog/sqlcoder-7b-2",
  "@cf/deepseek-ai/deepseek-math-7b-instruct",
  "@cf/thebloke/deepseek-coder-6.7b-instruct-awq",
  "@cf/thebloke/deepseek-coder-6.7b-base-awq",
  "@cf/thebloke/llamaguard-7b-awq",
  "@cf/thebloke/neural-chat-7b-v3-1-awq",
  "@cf/thebloke/openhermes-2.5-mistral-7b-awq",
  "@cf/thebloke/llama-2-13b-chat-awq",
  "@cf/thebloke/mistral-7b-instruct-v0.1-awq",
  "@cf/thebloke/zephyr-7b-beta-awq",
  "@cf/meta/llama-2-7b-chat-fp16",
  "@cf/mistral/mistral-7b-instruct-v0.1",
  "@cf/meta/llama-2-7b-chat-int8",
  "@cf/meta/llama-3.1-70b-instruct",
  "@cf/meta/llama-3.1-8b-instruct-fast",
];

const VERTEX_GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

interface OpenAIModelsResponse {
  data?: Array<{ id?: unknown }>;
}

interface AnthropicModelsResponse {
  data?: Array<{ id?: unknown }>;
}

interface GeminiModelsResponse {
  models?: Array<{
    name?: unknown;
    supportedGenerationMethods?: unknown;
  }>;
}

interface CloudflareModelItem {
  id?: unknown;
  name?: unknown;
  model?: unknown;
  model_id?: unknown;
}

interface CloudflareModelsResponse {
  result?: CloudflareModelItem[] | { data?: CloudflareModelItem[] };
  data?: CloudflareModelItem[];
}

function cleanGeminiModelName(name: string) {
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

function extractOpenAiModels(data: OpenAIModelsResponse) {
  return Array.isArray(data?.data)
    ? data.data
        .map((item) => item?.id)
        .filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.length > 0,
        )
    : [];
}

// NVIDIA Build serves its whole NIM catalog from one OpenAI-compatible `/models` endpoint, so the
// chat models arrive mixed in with embedding, reranking, and speech/OCR models that can never
// answer a review. This is a display-quality filter, not a correctness gate: an operator can still
// target any model id explicitly through repo config.
const NVIDIA_NON_CHAT_MODEL_PATTERNS = [
  /embed/i,
  /rerank/i,
  /retriever/i,
  /ocr/i,
  /parakeet/i,
  /riva/i,
  /\basr\b/i,
  /\btts\b/i,
  /speech/i,
];

const NVIDIA_BUILD_HOST = "integrate.api.nvidia.com";

function isNvidiaBuildBaseUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === NVIDIA_BUILD_HOST;
  } catch {
    return false;
  }
}

function isNonChatNvidiaModel(modelId: string) {
  return NVIDIA_NON_CHAT_MODEL_PATTERNS.some((pattern) =>
    pattern.test(modelId),
  );
}

function extractAnthropicModels(data: AnthropicModelsResponse) {
  return Array.isArray(data?.data)
    ? data.data
        .map((item) => item?.id)
        .filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.length > 0,
        )
    : [];
}

function extractGeminiModels(data: GeminiModelsResponse) {
  if (!Array.isArray(data?.models)) return [];

  const ids: string[] = [];
  for (const model of data.models) {
    const methods = model?.supportedGenerationMethods;
    if (Array.isArray(methods) && !methods.includes("generateContent"))
      continue;
    if (typeof model?.name !== "string") continue;
    const id = cleanGeminiModelName(model.name);
    if (id.length > 0) ids.push(id);
  }

  return ids;
}

export async function listProviderModels(input: {
  apiFormat: LlmApiFormat;
  baseUrl: string | null;
  apiKey?: string;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
}) {
  // Same guard the review adapters apply, so provider sync can't be pointed at a private URL.
  assertPublicBaseUrl(input.baseUrl, input.apiFormat);

  const baseUrl = (input.baseUrl || defaultBaseUrl(input.apiFormat)).replace(
    /\/+$/,
    "",
  );

  if (input.apiFormat === "openai") {
    if (!input.apiKey)
      throw new Error("OpenAI API key is required to list models.");
    const apiKey = input.apiKey;
    const response = await withTimeout(
      "OpenAI model list",
      MODEL_LIST_TIMEOUT_MS,
      (signal) =>
        fetch(`${baseUrl}/models`, {
          signal,
          headers: {
            authorization: `Bearer ${apiKey}`,
          },
        }),
    );
    if (!response.ok)
      throw new Error(
        `OpenAI model list failed with ${response.status}: ${await limitedErrorBody(response)}`,
      );
    const models = extractOpenAiModels(
      (await response.json()) as OpenAIModelsResponse,
    );
    // Host-gated so a custom OpenAI-format provider that happens to serve an id like "embed-1" is left alone.
    return isNvidiaBuildBaseUrl(baseUrl)
      ? models.filter((id) => !isNonChatNvidiaModel(id))
      : models;
  }

  if (input.apiFormat === "anthropic") {
    if (!input.apiKey)
      throw new Error("Anthropic API key is required to list models.");
    const apiKey = input.apiKey;
    const response = await withTimeout(
      "Anthropic model list",
      MODEL_LIST_TIMEOUT_MS,
      (signal) =>
        fetch(`${baseUrl}/models`, {
          signal,
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        }),
    );
    if (!response.ok)
      throw new Error(
        `Anthropic model list failed with ${response.status}: ${await limitedErrorBody(response)}`,
      );
    return extractAnthropicModels(
      (await response.json()) as AnthropicModelsResponse,
    );
  }

  if (input.apiFormat === "vertex") {
    return VERTEX_GEMINI_MODELS;
  }

  if (input.apiFormat === "gemini") {
    if (!input.apiKey)
      throw new Error("Google API key is required to list models.");
    const apiKey = input.apiKey;
    const url = `${baseUrl}/models`;
    const response = await withTimeout(
      "Google model list",
      MODEL_LIST_TIMEOUT_MS,
      (signal) =>
        fetch(url, {
          signal,
          headers: {
            "x-goog-api-key": apiKey,
          },
        }),
    );
    if (!response.ok)
      throw new Error(
        `Google model list failed with ${response.status}: ${await limitedErrorBody(response)}`,
      );
    return extractGeminiModels((await response.json()) as GeminiModelsResponse);
  }

  return listCloudflareModels(
    input.cloudflareAccountId,
    input.cloudflareApiToken,
  );
}

async function listCloudflareModels(accountId?: string, apiToken?: string) {
  if (!accountId || !apiToken) return CLOUDFLARE_TEXT_GENERATION_MODELS;

  const url = new URL(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`,
  );
  url.searchParams.set("task", "Text Generation");
  url.searchParams.set("per_page", "100");

  const response = await withTimeout(
    "Cloudflare model list",
    MODEL_LIST_TIMEOUT_MS,
    (signal) =>
      fetch(url.toString(), {
        signal,
        headers: {
          authorization: `Bearer ${apiToken}`,
        },
      }),
  );

  if (response.status === 401 || response.status === 403) {
    return CLOUDFLARE_TEXT_GENERATION_MODELS;
  }
  if (!response.ok)
    throw new Error(
      `Cloudflare model list failed with ${response.status}: ${await limitedErrorBody(response)}`,
    );
  const models = extractCloudflareModels(
    (await response.json()) as CloudflareModelsResponse,
  );
  return models.length > 0 ? models : CLOUDFLARE_TEXT_GENERATION_MODELS;
}

function extractCloudflareModels(data: CloudflareModelsResponse) {
  const items = Array.isArray(data?.result)
    ? data.result
    : typeof data?.result === "object" &&
        data.result !== null &&
        "data" in data.result &&
        Array.isArray((data.result as { data?: unknown[] }).data)
      ? (data.result as { data?: unknown[] }).data
      : Array.isArray(data?.data)
        ? data.data
        : [];

  return Array.from(
    new Set(
      (items || [])
        .map((item: any) =>
          normalizeCloudflareModelId(
            item?.id ?? item?.name ?? item?.model ?? item?.model_id,
          ),
        )
        .filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.startsWith("@cf/"),
        ),
    ),
  );
}

function normalizeCloudflareModelId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("@cf/")) return trimmed;
  if (trimmed.startsWith("cf/")) return `@${trimmed}`;
  return null;
}

async function limitedErrorBody(response: Response) {
  const body = await response.text().catch(() => "");
  if (!body) return response.statusText || "request failed";
  return body.length > ERROR_BODY_LIMIT
    ? `${body.slice(0, ERROR_BODY_LIMIT)}...`
    : body;
}

function defaultBaseUrl(apiFormat: LlmApiFormat) {
  if (apiFormat === "cloudflare-workers-ai") return "";
  // No universal default: a Vertex base URL embeds the caller's project ID and region.
  if (apiFormat === "vertex") return "";
  if (apiFormat === "gemini")
    return "https://generativelanguage.googleapis.com/v1beta";
  if (apiFormat === "anthropic") return "https://api.anthropic.com/v1";
  return "https://api.openai.com/v1";
}
