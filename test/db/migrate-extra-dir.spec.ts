import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, expect, it } from "vitest";
import { queryRows, runWithDb } from "@codraoss/db/client";
import { createTestEnv, dbDescribe, getTestDatabaseUrl } from "../helpers";

const execFileAsync = promisify(execFile);
const env = createTestEnv();

const probeTable = "codra_extra_migration_probe";
const trackedName = "extra:001_probe.sql";

async function cleanup() {
  await runWithDb(env, async () => {
    await queryRows(env, `DROP TABLE IF EXISTS ${probeTable}`);
    await queryRows(env, "DELETE FROM schema_migrations WHERE name = $1", [
      trackedName,
    ]);
  });
}

dbDescribe("migrate.mjs --extra-dir", () => {
  afterAll(cleanup);

  it("applies extra migrations after the core set and tracks them under an extra: prefix", async () => {
    await cleanup();

    const extraDir = await mkdtemp(
      path.join(tmpdir(), "codra-extra-migrations-"),
    );
    try {
      await writeFile(
        path.join(extraDir, "001_probe.sql"),
        `CREATE TABLE IF NOT EXISTS ${probeTable} (id TEXT PRIMARY KEY);\n`,
        "utf8",
      );

      const { stdout } = await execFileAsync(
        process.execPath,
        ["packages/db/scripts/migrate.mjs", `--extra-dir=${extraDir}`],
        {
          cwd: process.cwd(),
          env: { ...process.env, DATABASE_URL: getTestDatabaseUrl() },
        },
      );

      expect(stdout).toContain(`Applied ${trackedName}.`);

      await runWithDb(env, async () => {
        const tracked = await queryRows<{ name: string }>(
          env,
          "SELECT name FROM schema_migrations WHERE name = $1",
          [trackedName],
        );
        expect(tracked).toHaveLength(1);

        const core = await queryRows<{ name: string }>(
          env,
          "SELECT name FROM schema_migrations WHERE name = '001_initial.sql'",
        );
        expect(core).toHaveLength(1);

        const probe = await queryRows<{ name: string | null }>(
          env,
          "SELECT to_regclass($1) AS name",
          [`public.${probeTable}`],
        );
        expect(probe[0]?.name).not.toBeNull();
      });
    } finally {
      await rm(extraDir, { recursive: true, force: true });
    }
  });

  it("fails loudly when the configured extra directory does not exist", async () => {
    const missing = path.join(
      tmpdir(),
      "codra-extra-migrations-does-not-exist",
    );

    await expect(
      execFileAsync(
        process.execPath,
        ["packages/db/scripts/migrate.mjs", `--extra-dir=${missing}`],
        {
          cwd: process.cwd(),
          env: { ...process.env, DATABASE_URL: getTestDatabaseUrl() },
        },
      ),
    ).rejects.toThrow(/Extra migrations directory not readable/);
  });
});
