import type { DbEnv } from "./env";
import { parseJsonColumn, queryRows } from "./client";

export async function recordWebhookDelivery(
  env: DbEnv,
  input: {
    deliveryId: string;
    eventName: string;
    owner: string | null;
    repo: string | null;
    payload: unknown;
  },
) {
  let repositoryId: number | null = null;

  if (input.owner && input.repo) {
    const [repoRow] = await queryRows<{ id: number }>(
      env,
      "SELECT id FROM repositories WHERE owner = $1 AND repo = $2",
      [input.owner, input.repo],
    );
    if (repoRow) {
      repositoryId = repoRow.id;
    }
  }

  const rows = await queryRows<{ id: string }>(
    env,
    `
      INSERT INTO webhook_deliveries (delivery_id, event_name, repository_id, payload)
      VALUES ($1, $2, $3, $4::text::jsonb)
      ON CONFLICT (delivery_id) DO NOTHING
      RETURNING id
    `,
    [
      input.deliveryId,
      input.eventName,
      repositoryId,
      JSON.stringify(input.payload),
    ],
  );

  // Returned rather than discarded so callers that need it (the feedback handler) don't pay for a second identical lookup.
  return { inserted: rows.length > 0, repositoryId };
}

export async function getWebhookDelivery(env: DbEnv, deliveryId: string) {
  const [row] = await queryRows<{
    delivery_id: string;
    event_name: string;
    payload: unknown;
  }>(
    env,
    `
      SELECT delivery_id, event_name, payload
      FROM webhook_deliveries
      WHERE delivery_id = $1
      LIMIT 1
    `,
    [deliveryId],
  );

  return row ? { ...row, payload: parseJsonColumn(row.payload, null) } : null;
}
