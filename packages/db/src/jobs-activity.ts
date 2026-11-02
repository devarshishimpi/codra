import type { DbEnv } from "./env";
import { SYSTEM_ACTIVE_JOBS_KEY } from "./constants";

// Holds KV flag for maintenance loop. Leaf module to avoid import cycles.

export async function markSystemActive(env: DbEnv) {
  try {
    // claimJobLease calls this; read before write to save KV write quota.
    const existing = await env.APP_KV.get(SYSTEM_ACTIVE_JOBS_KEY);
    if (existing) return;
    await env.APP_KV.put(SYSTEM_ACTIVE_JOBS_KEY, "1", {
      expirationTtl: 20 * 60,
    });
  } catch (error) {
    // Ignore KV errors to avoid failing the DB transaction
  }
}

export async function clearSystemActive(env: DbEnv) {
  try {
    await env.APP_KV.delete(SYSTEM_ACTIVE_JOBS_KEY);
  } catch (error) {
    // Best-effort: the 20-minute TTL on the flag is the backstop if this delete fails.
  }
}
