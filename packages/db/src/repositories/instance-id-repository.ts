import type { InstanceIdStore } from "@codraoss/core/ports";
import type { DbEnv } from "../env";
import { queryRows } from "../client";
import { INSTANCE_ID_KEY } from "../constants";

export function makeInstanceIdStore(env: DbEnv): InstanceIdStore {
  return {
    getOrCreateInstanceId: async () => {
      try {
        const rows = await queryRows<{ value: string }>(
          env,
          "SELECT value FROM global_settings WHERE key = $1",
          [INSTANCE_ID_KEY],
        );
        let instanceId = rows[0]?.value;

        if (!instanceId) {
          instanceId = crypto.randomUUID();
          await queryRows(
            env,
            "INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
            [INSTANCE_ID_KEY, instanceId],
          );
          const rowsAfter = await queryRows<{ value: string }>(
            env,
            "SELECT value FROM global_settings WHERE key = $1",
            [INSTANCE_ID_KEY],
          );
          instanceId = rowsAfter[0]?.value ?? instanceId;
        }
        return instanceId;
      } catch (error) {
        // Fallback so telemetry can still send, though it will count as a new "install" if the DB is failing.
        return crypto.randomUUID();
      }
    },
  };
}
