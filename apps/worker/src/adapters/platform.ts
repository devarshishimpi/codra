import type {
  Clock,
  IdGenerator,
  KvStore,
  TelemetrySink,
} from "@codraoss/core/ports";
import type { AppBindings } from "../env";
import { sendTelemetryEvent } from "../core/telemetry";

// env.APP_KV already satisfies KvStore structurally; the wrapper narrows it to the two methods the
// engine may use, so a future reach for `list` or `delete` fails here rather than in the engine.
export function makeKvStore(env: AppBindings): KvStore {
  return {
    get: (key) => env.APP_KV.get(key),
    put: (key, value, options) => env.APP_KV.put(key, value, options),
  };
}

export const systemClock: Clock = { now: () => Date.now() };

export const cryptoIds: IdGenerator = { randomUUID: () => crypto.randomUUID() };

// The instance id, package version, opt-out checks and the fetch all stay in
// src/server/core/telemetry.ts: none of them belong behind a package boundary, and the version comes
// from a repo-root package.json that no package-relative path can reach.
export function makeTelemetrySink(env: AppBindings): TelemetrySink {
  return { send: (event) => sendTelemetryEvent(env, event) };
}
