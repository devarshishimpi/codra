import type { RepoConfigRecord } from "@codraoss/schema";
import {
  EMPTY_MODEL_ROUTE,
  type ModelOption,
  type ModelRouteConfig,
  type ProviderOption,
} from "@client/components/features/models/model-route";
import { repoId } from "@client/components/features/repos/repo-route";

export type ReposState = {
  repos: RepoConfigRecord[];
  globalConfig: ModelRouteConfig;
  modelOptions: ModelOption[];
  providerOptions: ProviderOption[];
  error: string | null;
  loading: boolean;
};

export type ReposAction =
  | { type: "load-started" }
  | {
      type: "load-succeeded";
      repos: RepoConfigRecord[];
      globalConfig: ModelRouteConfig;
      modelOptions: ModelOption[];
      providerOptions: ProviderOption[];
    }
  | { type: "load-failed"; message: string }
  | { type: "sync-started" }
  | { type: "sync-failed"; message: string }
  | {
      type: "repo-merged";
      targetId: string;
      updates: Partial<RepoConfigRecord>;
    };

export const INITIAL_REPOS_STATE: ReposState = {
  repos: [],
  globalConfig: EMPTY_MODEL_ROUTE,
  modelOptions: [],
  providerOptions: [],
  error: null,
  loading: true,
};

export function reposReducer(
  state: ReposState,
  action: ReposAction,
): ReposState {
  switch (action.type) {
    case "load-started":
      return { ...state, loading: true };
    case "load-succeeded":
      return {
        ...state,
        repos: action.repos,
        globalConfig: action.globalConfig,
        modelOptions: action.modelOptions,
        providerOptions: action.providerOptions,
        loading: false,
      };
    case "load-failed":
      return { ...state, error: action.message, loading: false };
    case "sync-started":
      return { ...state, error: null };
    case "sync-failed":
      return { ...state, error: action.message };
    case "repo-merged":
      return {
        ...state,
        repos: state.repos.map((repo) =>
          repoId(repo) === action.targetId
            ? { ...repo, ...action.updates }
            : repo,
        ),
      };
  }
}
