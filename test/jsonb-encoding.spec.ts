import { describe, expect, it } from "vitest";
import { defaultRepoConfig } from "@codraoss/schema";
import { queryRows } from "@codraoss/db/client";
import { insertJob } from "@codraoss/db/jobs";
import { upsertFileReview } from "@codraoss/db/file-reviews";
import { syncRepoConfig, upsertRepoConfig } from "@codraoss/db/repo-configs";
import { createTestEnv } from "./helpers";

// JSON.stringify bound to $n::jsonb stores a jsonb string scalar; SQL JSON operators then read
// nothing, though parseJsonColumn tolerates both shapes (bug reached 1,215 rows). Fix: $n::text::jsonb.
// Do not bind raw values; normalizeParam turns arrays into Postgres array literals.
describe("jsonb columns are stored as jsonb, not as string scalars", () => {
  const env = createTestEnv();
  const unique = () =>
    `jsonb-enc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function shapeOf(
    table: string,
    column: string,
    where: string,
    params: unknown[],
  ) {
    const [row] = await queryRows<{ shape: string | null }>(
      env,
      `SELECT jsonb_typeof(${column}) AS shape FROM ${table} WHERE ${where}`,
      params,
    );
    return row?.shape ?? null;
  }

  it("stores repo_configs.parsed_json as an object that SQL can read", async () => {
    const repo = unique();
    await upsertRepoConfig(env, {
      installationId: "900001",
      owner: "jsonb-owner",
      repo,
      parsedJson: defaultRepoConfig,
    });

    const where = `repository_id = (SELECT id FROM repositories WHERE owner = $1 AND repo = $2)`;
    expect(
      await shapeOf("repo_configs", "parsed_json", where, [
        "jsonb-owner",
        repo,
      ]),
    ).toBe("object");

    // Regression check: shape alone could pass while nesting was still wrong.
    const [row] = await queryRows<{ severity: string | null }>(
      env,
      `SELECT parsed_json->'review'->>'min_severity' AS severity FROM repo_configs WHERE ${where}`,
      ["jsonb-owner", repo],
    );
    expect(row?.severity).toBe(defaultRepoConfig.review.min_severity);
  });

  // Arrays are where raw binding breaks; @> containment (used by migrate.mjs) never matches a string scalar.
  it("stores the repo_configs model arrays so containment matches", async () => {
    const repo = unique();
    await upsertRepoConfig(env, {
      installationId: "900001",
      owner: "jsonb-owner",
      repo,
      parsedJson: {
        ...defaultRepoConfig,
        model: {
          main: "model-main",
          fallbacks: ["model-a", "model-b"],
          size_overrides: [],
        },
      },
    });

    const where = `repository_id = (SELECT id FROM repositories WHERE owner = $1 AND repo = $2)`;
    expect(
      await shapeOf("repo_configs", "fallback_models", where, [
        "jsonb-owner",
        repo,
      ]),
    ).toBe("array");

    const [row] = await queryRows<{ matched: boolean }>(
      env,
      `SELECT fallback_models @> jsonb_build_array($3::text) AS matched FROM repo_configs WHERE ${where}`,
      ["jsonb-owner", repo, "model-b"],
    );
    expect(row?.matched).toBe(true);
  });

  it("stores repo_configs.parsed_json as an object on the sync path too", async () => {
    // syncRepoConfig is a separate insert path that wrote every production row.
    const repo = unique();
    await syncRepoConfig(env, {
      installationId: "900001",
      owner: "jsonb-owner",
      repo,
    });

    const where = `repository_id = (SELECT id FROM repositories WHERE owner = $1 AND repo = $2)`;
    expect(
      await shapeOf("repo_configs", "parsed_json", where, [
        "jsonb-owner",
        repo,
      ]),
    ).toBe("object");
  });

  it("stores jobs.config_snapshot as an object", async () => {
    const job = await insertJob(env, {
      installationId: "900001",
      owner: "jsonb-owner",
      repo: unique(),
      prNumber: 1,
      prTitle: "jsonb encoding",
      prAuthor: "tester",
      commitSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      trigger: "auto",
      headRef: "head",
      baseRef: "main",
      configSnapshot: defaultRepoConfig,
    });

    expect(
      await shapeOf("jobs", "config_snapshot", "id = $1::uuid", [job.id]),
    ).toBe("object");
  });

  it("stores file_reviews.withheld_counts so the SQL aggregate can read it", async () => {
    const job = await insertJob(env, {
      installationId: "900001",
      owner: "jsonb-owner",
      repo: unique(),
      prNumber: 2,
      prTitle: "jsonb encoding",
      prAuthor: "tester",
      commitSha: "c".repeat(40),
      baseSha: "d".repeat(40),
      trigger: "auto",
      headRef: "head",
      baseRef: "main",
      configSnapshot: defaultRepoConfig,
    });

    await upsertFileReview(env, job.id, {
      filePath: "src/withheld.ts",
      fileStatus: "done",
      modelUsed: "test-model",
      diffLineCount: 1,
      diffInput: null,
      rawAiOutput: null,
      parsedComments: [],
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      verdict: "approve",
      fileSummary: null,
      errorMessage: null,
      withheldCounts: { evidence: 5, claimDenied: 2 },
    });

    // This exact read reported zero despite five withheld findings.
    const [row] = await queryRows<{ evidence: string | null }>(
      env,
      `SELECT withheld_counts->>'evidence' AS evidence FROM file_reviews WHERE job_id = $1::uuid`,
      [job.id],
    );
    expect(row?.evidence).toBe("5");
  });

  // Sweep: catches new write sites the per-helper tests above don't cover.
  it("leaves no string-encoded row in any jsonb column", async () => {
    const columns: Array<[string, string]> = [
      ["repo_configs", "parsed_json"],
      ["repo_configs", "fallback_models"],
      ["repo_configs", "size_overrides"],
      ["jobs", "config_snapshot"],
      ["file_reviews", "withheld_counts"],
    ];

    const offenders: string[] = [];
    for (const [table, column] of columns) {
      const [row] = await queryRows<{ n: number }>(
        env,
        `SELECT count(*)::int AS n FROM ${table}
         WHERE ${column} IS NOT NULL AND jsonb_typeof(${column}) = 'string'`,
      );
      if ((row?.n ?? 0) > 0)
        offenders.push(`${table}.${column} (${row.n} rows)`);
    }

    expect(offenders).toEqual([]);
  });
});
