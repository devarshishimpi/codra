import { describe, it, expect, vi, afterEach } from "vitest";
import { listProviderModels } from "../../src/catalog";

// NVIDIA Build serves chat NIMs and non-chat NIMs (embedding, reranking, speech, OCR) from the same
// OpenAI-compatible /models endpoint. Without a filter, provider sync writes the non-chat ones into
// model_configs and they show up in every model picker as if they could review a diff.

const MIXED_MODEL_LIST = {
  data: [
    { id: "meta/llama-3.3-70b-instruct" },
    { id: "deepseek-ai/deepseek-r1" },
    { id: "qwen/qwen2.5-coder-32b-instruct" },
    { id: "nvidia/llama-3.2-nv-embedqa-1b-v2" },
    { id: "nvidia/nv-rerankqa-mistral-4b-v3" },
    { id: "nvidia/nv-embed-v1" },
    { id: "nvidia/nemoretriever-parse" },
    { id: "baidu/paddleocr" },
    { id: "nvidia/parakeet-ctc-0.6b-asr" },
    { id: "nvidia/magpie-tts-multilingual" },
  ],
};

const CHAT_IDS = [
  "meta/llama-3.3-70b-instruct",
  "deepseek-ai/deepseek-r1",
  "qwen/qwen2.5-coder-32b-instruct",
];

function stubModelList(payload: unknown) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listProviderModels NVIDIA Build filtering", () => {
  it("drops embedding, reranking, retrieval, OCR, and speech NIMs from the NVIDIA catalog", async () => {
    stubModelList(MIXED_MODEL_LIST);

    const models = await listProviderModels({
      apiFormat: "openai",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "nvapi-test",
    });

    expect(models).toEqual(CHAT_IDS);
  });

  it("requests the standard OpenAI-compatible /models endpoint with a bearer key", async () => {
    const fetchMock = stubModelList(MIXED_MODEL_LIST);

    await listProviderModels({
      apiFormat: "openai",
      baseUrl: "https://integrate.api.nvidia.com/v1/",
      apiKey: "nvapi-test",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/models");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer nvapi-test",
    });
  });

  it("leaves an identical list untouched for other OpenAI-format providers", async () => {
    stubModelList(MIXED_MODEL_LIST);

    const models = await listProviderModels({
      apiFormat: "openai",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-test",
    });

    expect(models).toEqual(MIXED_MODEL_LIST.data.map((entry) => entry.id));
  });

  it("does not filter a self-hosted provider whose host merely resembles NVIDIA Build", async () => {
    stubModelList({
      data: [{ id: "nv-embed-v1" }, { id: "meta/llama-3.3-70b-instruct" }],
    });

    const models = await listProviderModels({
      apiFormat: "openai",
      baseUrl: "https://api.nvidia.example.com/v1",
      apiKey: "sk-test",
    });

    expect(models).toEqual(["nv-embed-v1", "meta/llama-3.3-70b-instruct"]);
  });
});
