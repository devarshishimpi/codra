import { Hono } from "hono";
import { z } from "zod";
import { jsonError } from "../../http";
import { llmApiFormats } from "@codraoss/schema";
import type { ApiEnv } from "../../ports";
import { requirePermission, requireQuota } from "../../middleware/authorize";

const apiFormatSchema = z.enum(llmApiFormats);
const positiveIntegerSchema = z.number().int().positive().finite();
const modelIdSchema = z.string().trim().min(1);
const optionalUrlSchema = z.string().trim().url().nullable().optional();
const providerIdSchema = z.string().uuid();

const providerCreateSchema = z.strictObject({
  name: z.string().trim().min(1),
  apiFormat: apiFormatSchema,
  baseUrl: optionalUrlSchema,
  apiKey: z.string().optional(),
  enabled: z.boolean().default(true),
});

// `.extend()` carries the parent's strictness through, so no second `.strict()` is needed here.
const providerUpdateSchema = providerCreateSchema.extend({
  clearApiKey: z.boolean().optional(),
});

const modelConfigUpdateSchema = z.strictObject({
  providerId: providerIdSchema,
  modelName: z.string().trim().min(1),
});

const globalModelConfigSchema = z.strictObject({
  main: modelIdSchema.nullable().default(null),
  fallbacks: z.array(modelIdSchema).nullable().default([]),
  size_overrides: z
    .array(
      z.strictObject({
        max_lines: positiveIntegerSchema,
        model: modelIdSchema,
        fallbacks: z.array(modelIdSchema).optional(),
      }),
    )
    .nullable()
    .optional(),
});

function requiresExplicitBaseUrl(
  apiFormat: z.infer<typeof apiFormatSchema>,
  baseUrl: string | null | undefined,
) {
  return apiFormat === "vertex" && !baseUrl;
}

function readModelIdParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createModelsRouter() {
  const app = new Hono<ApiEnv>();

  app.get("/", async (c) => {
    const denied = await requirePermission(c, "models.read");
    if (denied) return denied;
    const modelConfigsRepo = c.env.deps.repositories.modelConfigs;
    const [providers, configs] = await Promise.all([
      modelConfigsRepo.listLlmProviders(c.env as any),
      modelConfigsRepo.listModelConfigs(c.env as any),
    ]);
    return c.json({ providers, configs });
  });

  app.post("/sync", async (c) => {
    const denied = await requirePermission(c, "models.sync");
    if (denied) return denied;
    const modelConfigsRepo = c.env.deps.repositories.modelConfigs;
    const syncErrors = await c.env.deps.modelRunner.syncProviderModelCatalog();
    const [providers, configs] = await Promise.all([
      modelConfigsRepo.listLlmProviders(c.env as any),
      modelConfigsRepo.listModelConfigs(c.env as any),
    ]);
    return c.json({ providers, configs, syncErrors });
  });

  app.get("/global", async (c) => {
    const denied = await requirePermission(c, "models.read");
    if (denied) return denied;
    const config = await c.env.deps.config.getGlobalConfig();
    return c.json({ config });
  });

  app.patch("/global", async (c) => {
    const denied = await requirePermission(c, "models.global.write");
    if (denied) return denied;
    const body = await c.req.json();
    const parsed = globalModelConfigSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid global model config.", 400);
    }

    await c.env.deps.config.updateGlobalConfig(parsed.data);
    return c.json({ ok: true });
  });

  app.post("/providers", async (c) => {
    const denied = await requirePermission(c, "models.provider.create");
    if (denied) return denied;
    const parsed = providerCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return jsonError("Invalid provider config.", 400);
    }

    const input = parsed.data;
    if (
      input.apiFormat === "cloudflare-workers-ai" &&
      c.env.deps.cloudflareAiEnabled === false
    ) {
      return jsonError(
        "Cloudflare Workers AI is available only in the Cloudflare Workers runtime.",
        400,
      );
    }
    if (requiresExplicitBaseUrl(input.apiFormat, input.baseUrl)) {
      return jsonError(
        "Vertex AI requires a base URL with your GCP project ID and region, e.g. https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us-central1",
        400,
      );
    }

    try {
      const provider =
        await c.env.deps.modelRunner.createProviderWithSecret(input);
      return c.json({ provider }, 201);
    } catch (error) {
      const err = error as any;
      if (err.isUniqueNameError) {
        return jsonError(
          `Provider ${input.name} already exists. Update the existing provider instead.`,
          409,
        );
      }
      if (err.isEncryptionConfigError) {
        return jsonError(
          err.message || "LLM encryption is not configured.",
          400,
        );
      }
      if (err.isKeyRequiredError) {
        return jsonError(
          `Provider ${input.name} needs an API key before it can be enabled.`,
          400,
        );
      }
      throw error;
    }
  });

  app.patch("/providers/:id", async (c) => {
    const denied = await requirePermission(c, "models.provider.update", {
      type: "llmProvider",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const id = c.req.param("id");
    if (!providerIdSchema.safeParse(id).success) {
      return jsonError("Invalid provider id.", 400);
    }

    const parsed = providerUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return jsonError("Invalid provider config.", 400);
    }

    const input = parsed.data;
    if (
      input.apiFormat === "cloudflare-workers-ai" &&
      c.env.deps.cloudflareAiEnabled === false
    ) {
      return jsonError(
        "Cloudflare Workers AI is available only in the Cloudflare Workers runtime.",
        400,
      );
    }
    if (requiresExplicitBaseUrl(input.apiFormat, input.baseUrl)) {
      return jsonError(
        "Vertex AI requires a base URL with your GCP project ID and region, e.g. https://us-central1-aiplatform.googleapis.com/v1/projects/YOUR_PROJECT_ID/locations/us-central1",
        400,
      );
    }

    try {
      const provider = await c.env.deps.modelRunner.updateProviderWithSecret(
        id,
        input,
      );
      if (!provider) return jsonError("Provider not found.", 404);
      return c.json({ provider });
    } catch (error) {
      const err = error as any;
      if (err.isUniqueNameError) {
        return jsonError(
          `Provider ${input.name} already exists. Choose a different provider name.`,
          409,
        );
      }
      if (err.isEncryptionConfigError) {
        return jsonError(
          err.message || "LLM encryption is not configured.",
          400,
        );
      }
      if (err.isKeyRequiredError) {
        return jsonError(
          `Provider ${input.name} needs an API key before it can be enabled.`,
          400,
        );
      }
      throw error;
    }
  });

  app.delete("/providers/:id", async (c) => {
    const denied = await requirePermission(c, "models.provider.delete", {
      type: "llmProvider",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const id = c.req.param("id");
    if (!providerIdSchema.safeParse(id).success) {
      return jsonError("Invalid provider id.", 400);
    }

    const result = await c.env.deps.repositories.modelConfigs.deleteLlmProvider(
      c.env as any,
      id,
    );
    if (!result.deleted) {
      return jsonError(
        result.reason ?? "Provider not found.",
        result.reason ? 409 : 404,
      );
    }
    return c.json({ ok: true });
  });

  app.post("/:id/test", async (c) => {
    const denied = await requirePermission(c, "models.test", {
      type: "modelConfig",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const throttled = await requireQuota(c, { action: "models.test" });
    if (throttled) return throttled;
    const modelId = readModelIdParam(c.req.param("id"));
    const parsedModelId = modelIdSchema.safeParse(modelId);
    if (!parsedModelId.success) {
      return jsonError("Invalid model id.", 400);
    }

    try {
      const response = await c.env.deps.modelRunner.testConnection(
        parsedModelId.data,
      );
      return c.json(response);
    } catch (error) {
      const err = error as any;
      if (err.isNotFoundError) return jsonError("Model not found.", 404);
      if (err.isDisabledError || err.isMissingKeyError)
        return jsonError(err.message, 400);

      return jsonError(
        err.message || "Connection test failed.",
        err.status || 502,
      );
    }
  });

  app.post("/:id", async (c) => {
    const denied = await requirePermission(c, "models.mapping.write", {
      type: "modelConfig",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const modelId = readModelIdParam(c.req.param("id"));
    const parsedModelId = modelIdSchema.safeParse(modelId);
    if (!parsedModelId.success) {
      return jsonError("Invalid model id.", 400);
    }

    const body = await c.req.json();
    const parsed = modelConfigUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid model config.", 400);
    }

    const saved = await c.env.deps.repositories.modelConfigs.updateModelConfig(
      c.env as any,
      {
        modelId: parsedModelId.data,
        providerId: parsed.data.providerId,
        modelName: parsed.data.modelName,
      },
    );

    if (!saved) return jsonError("Provider not found.", 404);
    return c.json({ ok: true, config: saved });
  });

  app.delete("/:id", async (c) => {
    const denied = await requirePermission(c, "models.mapping.write", {
      type: "modelConfig",
      id: c.req.param("id"),
    });
    if (denied) return denied;
    const modelId = readModelIdParam(c.req.param("id"));
    const parsedModelId = modelIdSchema.safeParse(modelId);
    if (!parsedModelId.success) {
      return jsonError("Invalid model id.", 400);
    }

    const deleted =
      await c.env.deps.repositories.modelConfigs.deleteModelConfig(
        c.env as any,
        parsedModelId.data,
      );
    if (!deleted) return jsonError("Model not found.", 404);
    return c.json({ ok: true });
  });

  return app;
}
