import type { RepoConfigStore } from "@codraoss/core/ports";
import type { DbEnv } from "../env";
import { getRepoConfigRecord, syncRepoConfig } from "../repo-configs";

export function makeRepoConfigStore(env: DbEnv): RepoConfigStore {
  return {
    getRepoConfigRecord: (owner, repo) => getRepoConfigRecord(env, owner, repo),
    syncRepoConfig: (input) => syncRepoConfig(env, input),
  };
}
