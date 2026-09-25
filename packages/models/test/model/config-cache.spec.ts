import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEnv, createTestModelRunner } from "../../../../test/helpers";

// Isolated in its own file: mocking @codraoss/db/model-configs module-wide would break the
// other model-service tests that resolve configs against the real test DB.
const getResolvedModelConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@codraoss/db/model-configs", async (importOriginal) => {
  const mod = await importOriginal<any>();
  return { ...mod, getResolvedModelConfig: getResolvedModelConfigMock };
});

const cloudflareConfig = (modelId: string) => ({
  modelId,
  providerId: "cf",
  providerName: "Cloudflare",
  apiFormat: "cloudflare-workers-ai" as const,
  modelName: modelId,
  updatedAt: new Date().toISOString(),
  providerEnabled: true,
  baseUrl: null,
  encryptedApiKey: null,
});

describe("ModelRunner model-config caching", () => {
  beforeEach(() => {
    getResolvedModelConfigMock.mockReset();
  });

  it("resolves a given model config from the DB at most once per invocation", async () => {
    getResolvedModelConfigMock.mockImplementation(
      async (_env: any, modelId: string) => cloudflareConfig(modelId),
    );
    const service = createTestModelRunner(createTestEnv());

    // The same model is resolved repeatedly across a chunk (once per file); only the first
    // should hit the DB.
    await (service as any).resolveModel("@cf/zai-org/glm-4.7-flash");
    await (service as any).resolveModel("@cf/zai-org/glm-4.7-flash");
    await (service as any).resolveModel("@cf/zai-org/glm-4.7-flash");

    expect(getResolvedModelConfigMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a separate cache entry per distinct model id", async () => {
    getResolvedModelConfigMock.mockImplementation(
      async (_env: any, modelId: string) => cloudflareConfig(modelId),
    );
    const service = createTestModelRunner(createTestEnv());

    await (service as any).resolveModel("gemini-3.1-pro-preview");
    await (service as any).resolveModel("gemini-2.5-pro");
    await (service as any).resolveModel("gemini-3.1-pro-preview");

    expect(getResolvedModelConfigMock).toHaveBeenCalledTimes(2);
  });

  it('caches a null "not configured" result so it is not re-queried every file', async () => {
    getResolvedModelConfigMock.mockResolvedValue(null);
    const service = createTestModelRunner(createTestEnv());

    await expect(
      (service as any).resolveModel("does-not-exist"),
    ).rejects.toThrow("is not configured");
    await expect(
      (service as any).resolveModel("does-not-exist"),
    ).rejects.toThrow("is not configured");

    expect(getResolvedModelConfigMock).toHaveBeenCalledTimes(1);
  });

  it("does not share a cache across ModelRunner instances (one instance == one invocation)", async () => {
    getResolvedModelConfigMock.mockImplementation(
      async (_env: any, modelId: string) => cloudflareConfig(modelId),
    );
    const env = createTestEnv();

    await (createTestModelRunner(env) as any).resolveModel(
      "@cf/zai-org/glm-4.7-flash",
    );
    await (createTestModelRunner(env) as any).resolveModel(
      "@cf/zai-org/glm-4.7-flash",
    );

    expect(getResolvedModelConfigMock).toHaveBeenCalledTimes(2);
  });
});
