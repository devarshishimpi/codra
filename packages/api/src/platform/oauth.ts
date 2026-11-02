import { randomHex } from "@codraoss/schema/hex";
import type { KvCompat } from "./kv";

const OAUTH_STATE_TTL_SECONDS = 60 * 10;

function oauthStateKey(state: string) {
  return `oauth-state:${state}`;
}

export function parseAllowedUsers(input: string) {
  return new Set(
    input
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function createOAuthState(kv: KvCompat) {
  const state = randomHex();
  await kv.put(
    oauthStateKey(state),
    JSON.stringify({ createdAt: new Date().toISOString() }),
    { expirationTtl: OAUTH_STATE_TTL_SECONDS },
  );
  return state;
}

export async function consumeOAuthState(kv: KvCompat, state: string) {
  const key = oauthStateKey(state);
  const value = await kv.get(key);
  if (!value) {
    return false;
  }

  await kv.delete(key);
  return true;
}
