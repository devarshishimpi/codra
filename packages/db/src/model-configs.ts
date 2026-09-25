import type { DbEnv } from "./env";

import { queryRows } from "./client";
import { PROVIDER_COLUMNS, MODEL_SELECT } from "./constants";
import {
  KIMI_K2_5_MODEL,
  llmProviderSchema,
  modelConfigSchema,
  type LlmApiFormat,
  type LlmProvider,
  type ModelConfig,
  type ResolvedModelConfig,
  type LlmProviderSecret,
} from "@codraoss/schema";

export type { ResolvedModelConfig, LlmProviderSecret };

type ProviderRow = {
  id: string;
  name: string;
  api_format: LlmApiFormat;
  base_url: string | null;
  encrypted_api_key: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

type ModelConfigRow = {
  model_id: string;
  provider_id: string;
  provider_name: string;
  api_format: LlmApiFormat;
  model_name: string;
  updated_at: string;
};

function mapProvider(row: ProviderRow): LlmProvider {
  return llmProviderSchema.parse({
    id: row.id,
    name: row.name,
    apiFormat: row.api_format,
    baseUrl: row.base_url,
    enabled: row.enabled,
    hasApiKey: Boolean(row.encrypted_api_key),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapProviderSecret(row: ProviderRow): LlmProviderSecret {
  return {
    ...mapProvider(row),
    encryptedApiKey: row.encrypted_api_key,
  };
}

function mapModelConfig(row: ModelConfigRow): ModelConfig {
  return modelConfigSchema.parse({
    modelId: row.model_id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    apiFormat: row.api_format,
    modelName: row.model_name,
    updatedAt: row.updated_at,
  });
}

// The llm_providers column list, in one place, since it was inlined at six sites before, all needing updates for one new column.

export async function listLlmProviders(env: DbEnv): Promise<LlmProvider[]> {
  const rows = await queryRows<ProviderRow>(
    env,
    `SELECT ${PROVIDER_COLUMNS} FROM llm_providers ORDER BY name ASC`,
  );
  return rows.map(mapProvider);
}

export async function listLlmProviderSecrets(
  env: DbEnv,
): Promise<LlmProviderSecret[]> {
  const rows = await queryRows<ProviderRow>(
    env,
    `SELECT ${PROVIDER_COLUMNS} FROM llm_providers ORDER BY name ASC`,
  );
  return rows.map(mapProviderSecret);
}

export async function getLlmProvider(
  env: DbEnv,
  id: string,
): Promise<LlmProviderSecret | null> {
  const [row] = await queryRows<ProviderRow>(
    env,
    `SELECT ${PROVIDER_COLUMNS} FROM llm_providers WHERE id = $1`,
    [id],
  );
  return row ? mapProviderSecret(row) : null;
}

export async function createLlmProvider(
  env: DbEnv,
  input: {
    name: string;
    apiFormat: LlmApiFormat;
    baseUrl: string | null;
    encryptedApiKey: string | null;
    enabled: boolean;
  },
) {
  const [row] = await queryRows<ProviderRow>(
    env,
    `
    INSERT INTO llm_providers (name, api_format, base_url, encrypted_api_key, enabled, updated_at)
    VALUES ($1, $2, $3, $4, $5, now())
    RETURNING ${PROVIDER_COLUMNS}
    `,
    [
      input.name,
      input.apiFormat,
      input.baseUrl,
      input.encryptedApiKey,
      input.enabled,
    ],
  );
  return mapProvider(row);
}

export async function findLlmProviderByName(
  env: DbEnv,
  name: string,
): Promise<LlmProvider | null> {
  const [row] = await queryRows<ProviderRow>(
    env,
    `SELECT ${PROVIDER_COLUMNS} FROM llm_providers WHERE lower(name) = lower($1)`,
    [name],
  );
  return row ? mapProvider(row) : null;
}

export async function updateLlmProvider(
  env: DbEnv,
  id: string,
  input: {
    name: string;
    apiFormat: LlmApiFormat;
    baseUrl: string | null;
    encryptedApiKey?: string | null;
    enabled: boolean;
  },
) {
  const params: unknown[] = [
    id,
    input.name,
    input.apiFormat,
    input.baseUrl,
    input.enabled,
  ];
  let apiKeySql = "";
  if (input.encryptedApiKey !== undefined) {
    params.push(input.encryptedApiKey);
    apiKeySql = `, encrypted_api_key = $${params.length}`;
  }

  const [row] = await queryRows<ProviderRow>(
    env,
    `
    UPDATE llm_providers
    SET
      name = $2,
      api_format = $3,
      base_url = $4,
      enabled = $5,
      updated_at = now()
      ${apiKeySql}
    WHERE id = $1
    RETURNING ${PROVIDER_COLUMNS}
    `,
    params,
  );
  return row ? mapProvider(row) : null;
}

export async function deleteLlmProvider(env: DbEnv, id: string) {
  const [{ count }] = await queryRows<{ count: string }>(
    env,
    `SELECT COUNT(*)::text AS count FROM model_configs WHERE provider_id = $1`,
    [id],
  );
  if (Number(count) > 0) {
    return {
      deleted: false,
      reason: "Provider is still used by one or more models.",
    };
  }

  const rows = await queryRows<{ id: string }>(
    env,
    `DELETE FROM llm_providers WHERE id = $1 RETURNING id`,
    [id],
  );
  return { deleted: rows.length > 0, reason: null };
}

export async function listModelConfigs(env: DbEnv): Promise<ModelConfig[]> {
  const rows = await queryRows<ModelConfigRow>(
    env,
    `${MODEL_SELECT}
     WHERE mc.model_id <> $1
     ORDER BY mc.model_id ASC`,
    [KIMI_K2_5_MODEL],
  );
  return rows.map(mapModelConfig);
}

export async function getResolvedModelConfig(
  env: DbEnv,
  modelId: string,
): Promise<ResolvedModelConfig | null> {
  const [row] = await queryRows<
    ModelConfigRow & {
      provider_enabled: boolean;
      base_url: string | null;
      encrypted_api_key: string | null;
    }
  >(
    env,
    `
    SELECT
      mc.model_id,
      mc.provider_id,
      p.name AS provider_name,
      p.api_format,
      mc.model_name,
      mc.updated_at,
      p.enabled AS provider_enabled,
      p.base_url,
      p.encrypted_api_key
    FROM model_configs mc
    JOIN llm_providers p ON p.id = mc.provider_id
    WHERE mc.model_id = $1
    `,
    [modelId],
  );

  if (!row) return null;
  return {
    ...mapModelConfig(row),
    providerEnabled: row.provider_enabled,
    baseUrl: row.base_url,
    encryptedApiKey: row.encrypted_api_key,
  };
}

export async function updateModelConfig(
  env: DbEnv,
  config: Omit<ModelConfig, "updatedAt" | "providerName" | "apiFormat">,
) {
  const [row] = await queryRows<ModelConfigRow>(
    env,
    `
    WITH upserted AS (
      INSERT INTO model_configs (model_id, provider_id, model_name, provider, updated_at)
      SELECT $1, p.id, $3, p.api_format, now()
      FROM llm_providers p
      WHERE p.id = $2
      ON CONFLICT (model_id)
      DO UPDATE SET
        provider_id = EXCLUDED.provider_id,
        model_name = EXCLUDED.model_name,
        provider = EXCLUDED.provider,
        updated_at = now()
      RETURNING model_id, provider_id, model_name, updated_at
    )
    SELECT
      u.model_id,
      u.provider_id,
      p.name AS provider_name,
      p.api_format,
      u.model_name,
      u.updated_at
    FROM upserted u
    JOIN llm_providers p ON p.id = u.provider_id
    `,
    [config.modelId, config.providerId, config.modelName],
  );
  return row ? mapModelConfig(row) : null;
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "provider"
  );
}

export async function upsertDiscoveredModelConfigs(
  env: DbEnv,
  input: {
    providerId: string;
    providerName: string;
    apiFormat: LlmApiFormat;
    modelNames: string[];
  },
) {
  const uniqueModelNames = Array.from(
    new Set(
      input.modelNames.flatMap((name) => {
        const trimmed = name.trim();
        return trimmed ? [trimmed] : [];
      }),
    ),
  );
  if (uniqueModelNames.length === 0) return [];

  const providerSlug = slugify(input.providerName);
  const [existingForProvider, existingModelIds] = await Promise.all([
    queryRows<{ model_id: string; model_name: string }>(
      env,
      `SELECT model_id, model_name FROM model_configs WHERE provider_id = $1`,
      [input.providerId],
    ),
    queryRows<{ model_id: string }>(
      env,
      `SELECT model_id FROM model_configs WHERE model_id LIKE $1`,
      [`${providerSlug}:%`],
    ),
  ]);

  const existingModelNames = new Set(
    existingForProvider.map((row) => row.model_name),
  );
  const usedModelIds = new Set(existingModelIds.map((row) => row.model_id));
  const rowsToInsert: Array<{
    model_id: string;
    provider_id: string;
    model_name: string;
    provider: LlmApiFormat;
  }> = [];

  for (const modelName of uniqueModelNames) {
    if (existingModelNames.has(modelName)) continue;

    const base = `${providerSlug}:${modelName}`;
    let candidate = base;
    let suffix = 2;
    while (usedModelIds.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix++;
    }
    usedModelIds.add(candidate);

    rowsToInsert.push({
      model_id: candidate,
      provider_id: input.providerId,
      model_name: modelName,
      provider: input.apiFormat,
    });
  }

  if (rowsToInsert.length === 0) return [];

  const modelIds = rowsToInsert.map((row) => row.model_id);
  const providerIds = rowsToInsert.map((row) => row.provider_id);
  const modelNames = rowsToInsert.map((row) => row.model_name);
  const providers = rowsToInsert.map((row) => row.provider);

  const rows = await queryRows<ModelConfigRow>(
    env,
    `
    WITH incoming AS (
      SELECT *
      FROM unnest(
        $1::text[],
        $2::uuid[],
        $3::text[],
        $4::text[]
      ) AS item(model_id, provider_id, model_name, provider)
    ),
    inserted AS (
      INSERT INTO model_configs (model_id, provider_id, model_name, provider, updated_at)
      SELECT model_id, provider_id, model_name, provider, now()
      FROM incoming
      ON CONFLICT (model_id) DO NOTHING
      RETURNING model_id, provider_id, model_name, updated_at
    )
    SELECT
      i.model_id,
      i.provider_id,
      p.name AS provider_name,
      p.api_format,
      i.model_name,
      i.updated_at
    FROM inserted i
    JOIN llm_providers p ON p.id = i.provider_id
    ORDER BY i.model_id ASC
    `,
    [modelIds, providerIds, modelNames, providers],
  );

  return rows.map(mapModelConfig);
}

export async function deleteModelConfig(env: DbEnv, modelId: string) {
  const rows = await queryRows<{ model_id: string }>(
    env,
    `DELETE FROM model_configs WHERE model_id = $1 RETURNING model_id`,
    [modelId],
  );
  return rows.length > 0;
}
