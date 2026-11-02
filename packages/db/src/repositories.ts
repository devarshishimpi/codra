import type { DbEnv } from "./env";
import { queryRows } from "./client";

export type RepositoryRow = {
  id: number;
  installation_id: string; // BIGINT is returned as string by node-postgres
  owner: string;
  repo: string;
};

export async function getOrCreateRepository(
  env: DbEnv,
  input: { installationId: string; owner: string; repo: string },
): Promise<number> {
  const [row] = await queryRows<RepositoryRow>(
    env,
    `
      INSERT INTO repositories (installation_id, owner, repo)
      VALUES ($1, $2, $3)
      ON CONFLICT (owner, repo) DO UPDATE SET installation_id = EXCLUDED.installation_id
      RETURNING id
    `,
    [input.installationId, input.owner, input.repo],
  );

  return row.id;
}
