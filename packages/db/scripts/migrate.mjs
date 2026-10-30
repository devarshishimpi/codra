import postgres from "postgres";
import { lookup } from "node:dns/promises";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDatabaseUrlFromEnvFiles } from "./migrate-env.mjs";
import { splitSqlStatements } from "./migrate-sql-split.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const migrationsDir = path.join(rootDir, "migrations");
const migrationLockId = 93741624;

// An extra migrations directory can be layered on top of the core set: resolved against cwd so it works from anywhere, and tracked with an `extra:` prefix so its 002_x.sql cannot collide with a core 002_y.sql.
const extraDirInput =
  process.argv
    .find((arg) => arg.startsWith("--extra-dir="))
    ?.slice("--extra-dir=".length) ??
  process.env.CODRA_EXTRA_MIGRATIONS_DIR ??
  null;
const extraMigrationsDir = extraDirInput
  ? path.resolve(process.cwd(), extraDirInput)
  : null;
const extraTrackingPrefix = "extra:";
const kimiK25Model = "@cf/moonshotai/kimi-k2.5";
const kimiK26Model = "@cf/moonshotai/kimi-k2.6";

const databaseUrl =
  process.env.DATABASE_URL ?? (await readDatabaseUrlFromEnvFiles());

if (!databaseUrl) {
  console.error(
    [
      "DATABASE_URL is required to run database migrations.",
      "Cloudflare Worker secrets are not readable by this local Node script.",
      "Set DATABASE_URL in your shell/CI environment or add it to .dev.vars, .env.local, or .env.",
    ].join("\n"),
  );
  process.exit(1);
}

const databaseHost = new URL(databaseUrl).hostname;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  try {
    await lookup(databaseHost);
    break;
  } catch (error) {
    if (attempt === 5) {
      throw error;
    }
    console.log(`Database DNS lookup failed; retrying (${attempt}/5)...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

const sql = postgres(databaseUrl, {
  max: 1,
  fetch_types: false,
  prepare: false,
  onnotice: () => {},
});

function query(sqlText, params = []) {
  return sql.unsafe(sqlText, params, { prepare: false });
}

async function tableExists(tableName) {
  const rows = await query("SELECT to_regclass($1) AS name", [
    `public.${tableName}`,
  ]);
  return rows[0]?.name !== null;
}

async function appliedMigrations() {
  const rows = await query(
    "SELECT name FROM schema_migrations ORDER BY name ASC",
  );
  return new Set(rows.map((row) => row.name));
}

async function ensureMigrationTable() {
  if (await tableExists("schema_migrations")) {
    return;
  }

  await query(`
    CREATE TABLE schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function runMigration(dir, fileName, trackedName) {
  const filePath = path.join(dir, fileName);
  const migrationSql = await readFile(filePath, "utf8");

  console.log(`Applying ${trackedName}...`);
  for (const statement of splitSqlStatements(migrationSql)) {
    await query(statement);
  }
  await query("INSERT INTO schema_migrations (name) VALUES ($1)", [
    trackedName,
  ]);
  console.log(`Applied ${trackedName}.`);
}

async function listMigrationFiles(dir) {
  return (await readdir(dir))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
}

async function ensureModelCatalog() {
  if (!(await tableExists("model_configs"))) {
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS llm_providers (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name              TEXT        NOT NULL UNIQUE,
      api_format        TEXT        NOT NULL CHECK (api_format IN ('openai', 'anthropic', 'gemini', 'cloudflare-workers-ai', 'vertex')),
      base_url          TEXT,
      encrypted_api_key TEXT,
      enabled           BOOLEAN     NOT NULL DEFAULT TRUE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await query(`
    UPDATE llm_providers
    SET name = 'Cloudflare', updated_at = now()
    WHERE name = 'Cloudflare Workers AI'
  `);

  await query(`
    UPDATE llm_providers
    SET name = 'Google', updated_at = now()
    WHERE name = 'Google Gemini'
  `);

  await query(`
    INSERT INTO llm_providers (name, api_format, base_url, enabled)
    VALUES
      ('Cloudflare', 'cloudflare-workers-ai', NULL, TRUE),
      ('Google', 'gemini', 'https://generativelanguage.googleapis.com/v1beta', FALSE),
      ('OpenAI', 'openai', 'https://api.openai.com/v1', FALSE),
      ('Anthropic', 'anthropic', 'https://api.anthropic.com/v1', FALSE),
      ('OpenRouter', 'openai', 'https://openrouter.ai/api/v1', FALSE),
      ('xAI', 'openai', 'https://api.x.ai/v1', FALSE),
      ('NVIDIA', 'openai', 'https://integrate.api.nvidia.com/v1', FALSE),
      ('Vertex AI', 'vertex', NULL, FALSE)
    ON CONFLICT (name) DO UPDATE SET
      api_format = EXCLUDED.api_format,
      base_url = COALESCE(EXCLUDED.base_url, llm_providers.base_url),
      updated_at = now()
  `);

  await query(
    "ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS provider_id UUID",
  );
  await query(
    "ALTER TABLE model_configs ADD COLUMN IF NOT EXISTS model_name TEXT",
  );

  await query(
    `
      UPDATE model_configs mc
      SET
        provider_id = provider_record.id,
        model_name = COALESCE(mc.model_name, mc.model_id)
      FROM llm_providers provider_record
      WHERE mc.provider_id IS NULL
        AND (
          (mc.provider = 'cloudflare' AND provider_record.name = 'Cloudflare')
          OR (mc.provider = 'gemini' AND provider_record.name = 'Google')
          OR (mc.provider = 'google' AND provider_record.name = 'Google')
          OR (mc.provider = 'openai' AND provider_record.name = 'OpenAI')
          OR (mc.provider = 'anthropic' AND provider_record.name = 'Anthropic')
          OR (mc.provider = 'openrouter' AND provider_record.name = 'OpenRouter')
        )
    `,
  );

  await query(
    `
      UPDATE model_configs mc
      SET
        provider_id = provider_record.id,
        model_name = COALESCE(mc.model_name, mc.model_id),
        provider = 'cloudflare'
      FROM llm_providers provider_record
      WHERE mc.provider_id IS NULL
        AND provider_record.name = 'Cloudflare'
        AND mc.model_id LIKE '@cf/%'
    `,
  );

  await query(
    "UPDATE model_configs SET model_name = model_id WHERE model_name IS NULL",
  );

  await query(
    `
      INSERT INTO model_configs (model_id, provider, provider_id, model_name, updated_at)
      SELECT $1, 'cloudflare', p.id, $1, now()
      FROM llm_providers p
      WHERE p.name = 'Cloudflare'
      ON CONFLICT (model_id) DO UPDATE SET
        provider = EXCLUDED.provider,
        provider_id = EXCLUDED.provider_id,
        model_name = EXCLUDED.model_name,
        updated_at = now()
    `,
    [kimiK26Model],
  );

  await query(
    `
      INSERT INTO model_configs (model_id, provider, provider_id, model_name, updated_at)
      SELECT '@cf/zai-org/glm-4.7-flash', 'cloudflare', p.id, '@cf/zai-org/glm-4.7-flash', now()
      FROM llm_providers p
      WHERE p.name = 'Cloudflare'
      ON CONFLICT (model_id) DO UPDATE SET
        provider = EXCLUDED.provider,
        provider_id = EXCLUDED.provider_id,
        model_name = EXCLUDED.model_name,
        updated_at = now()
    `,
  );

  await query("DELETE FROM model_configs WHERE model_id = $1", [kimiK25Model]);

  await query(
    "ALTER TABLE model_configs ALTER COLUMN provider_id SET NOT NULL",
  );
  await query("ALTER TABLE model_configs ALTER COLUMN model_name SET NOT NULL");
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'model_configs_provider_id_fkey'
      ) THEN
        ALTER TABLE model_configs
          ADD CONSTRAINT model_configs_provider_id_fkey
          FOREIGN KEY (provider_id) REFERENCES llm_providers(id);
      END IF;
    END $$
  `);
  await query(
    "CREATE INDEX IF NOT EXISTS model_configs_provider_id_idx ON model_configs (provider_id)",
  );
}

async function normalizeRepoConfigs() {
  if (!(await tableExists("repo_configs"))) {
    return;
  }

  console.log("Normalizing repo configs...");
  const functionName = "codra_replace_deprecated_model";

  console.log(`Creating function: pg_temp.${functionName}`);
  await query(`
    CREATE FUNCTION pg_temp.${functionName}(input jsonb, old_value text, new_value text)
    RETURNS jsonb
    LANGUAGE sql
    IMMUTABLE
    AS $$
      SELECT CASE jsonb_typeof(input)
        WHEN 'string' THEN CASE WHEN input #>> '{}' = old_value THEN to_jsonb(new_value) ELSE input END
        WHEN 'array' THEN COALESCE(
          (
            SELECT jsonb_agg(pg_temp.${functionName}(value, old_value, new_value) ORDER BY ord)
            FROM jsonb_array_elements(input) WITH ORDINALITY AS item(value, ord)
          ),
          '[]'::jsonb
        )
        WHEN 'object' THEN COALESCE(
          (
            SELECT jsonb_object_agg(key, pg_temp.${functionName}(value, old_value, new_value))
            FROM jsonb_each(input)
          ),
          '{}'::jsonb
        )
        ELSE input
      END
    $$
  `);

  console.log("Updating repo configs...");
  await query(
    `
      UPDATE repo_configs
      SET
        main_model = CASE WHEN main_model = $1 THEN $2 ELSE main_model END,
        fallback_models = CASE
          WHEN fallback_models IS NULL THEN NULL
          ELSE pg_temp.${functionName}(fallback_models, $1, $2)
        END,
        size_overrides = CASE
          WHEN size_overrides IS NULL THEN NULL
          ELSE pg_temp.${functionName}(size_overrides, $1, $2)
        END,
        parsed_json = CASE
          WHEN parsed_json IS NULL THEN NULL
          ELSE pg_temp.${functionName}(parsed_json, $1, $2)
        END
      WHERE main_model = $1
        OR fallback_models @> jsonb_build_array($1::text)
        OR size_overrides @> jsonb_build_array(jsonb_build_object('model', $1::text))
        OR size_overrides @> jsonb_build_array(jsonb_build_object('fallbacks', jsonb_build_array($1::text)))
        OR parsed_json::text LIKE '%' || $1 || '%'
    `,
    [kimiK25Model, kimiK26Model],
  );

  console.log(`Dropping function: pg_temp.${functionName}`);
  await query(
    `DROP FUNCTION IF EXISTS pg_temp.${functionName}(jsonb, text, text)`,
  );
  console.log("Repo configs normalized.");
}

async function main() {
  try {
    console.log("Starting database migrations...");
    await query("BEGIN");
    try {
      // Transaction-scoped on purpose: a session-scoped lock survives a process that dies before unlocking and blocks every later migrate, while these release on COMMIT/ROLLBACK/disconnect.
      console.log("Acquiring advisory lock...");
      await query("SET LOCAL lock_timeout = '30s'");
      await query("SELECT pg_advisory_xact_lock($1)", [migrationLockId]);

      await ensureMigrationTable();

      const migrationFiles = await listMigrationFiles(migrationsDir);

      const applied = await appliedMigrations();
      for (const migration of migrationFiles) {
        if (!applied.has(migration)) {
          await runMigration(migrationsDir, migration, migration);
        }
      }

      // Strictly after the core set, since extra migrations may reference core tables, and inside the same transaction and advisory lock so a failure rolls the core ones back too.
      if (extraMigrationsDir) {
        let extraFiles;
        try {
          extraFiles = await listMigrationFiles(extraMigrationsDir);
        } catch (error) {
          throw new Error(
            `Extra migrations directory not readable: ${extraMigrationsDir}`,
            { cause: error },
          );
        }

        for (const migration of extraFiles) {
          const trackedName = `${extraTrackingPrefix}${migration}`;
          if (!applied.has(trackedName)) {
            await runMigration(extraMigrationsDir, migration, trackedName);
          }
        }
      }

      console.log("Running catalog and config normalizations...");
      await query("DROP INDEX IF EXISTS repositories_owner_idx");
      await query(
        "CREATE INDEX IF NOT EXISTS repositories_owner_idx ON repositories (owner)",
      );
      await ensureModelCatalog();
      await normalizeRepoConfigs();

      await query("COMMIT");
    } catch (error) {
      await query("ROLLBACK");
      throw error;
    }

    console.log("Database migrations are up to date.");
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
