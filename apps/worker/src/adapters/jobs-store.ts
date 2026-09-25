import type { AppBindings } from "../env";
import type { JobStore } from "@codraoss/core/ports";
import { makeJobStore as makeDbJobStore } from "@codraoss/db/repositories";
import type { DbEnv } from "@codraoss/db/env";

export function makeJobStore(env: AppBindings): JobStore {
  const dbEnv: DbEnv = {
    HYPERDRIVE: env.HYPERDRIVE,
    APP_KV: env.APP_KV,
    workerMode: true,
  };
  return makeDbJobStore(dbEnv);
}
