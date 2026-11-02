import { formatDateTime } from "@client/lib/timezone";
import type { RepoConfig, RepoConfigRecord } from "@codraoss/schema";
import {
  EMPTY_MODEL_ROUTE,
  normalizeModelRoute,
  routesEqual,
  type ModelRouteConfig,
} from "@client/components/features/models/model-route";
// Shared by the repos page, its rows and the strategy dialog, so it can't live in any single one.

export type GlobalModelConfig = RepoConfig["model"];

export function repoId(repo: Pick<RepoConfigRecord, "owner" | "repo">) {
  return `${repo.owner}/${repo.repo}`;
}

export function hasStoredModelStrategy(repo: RepoConfigRecord) {
  return (
    repo.mainModel !== null ||
    repo.fallbackModels !== null ||
    repo.sizeOverrides !== null
  );
}

export function getGlobalRoute(
  globalConfig: GlobalModelConfig | ModelRouteConfig | null,
): ModelRouteConfig {
  return normalizeModelRoute(globalConfig);
}

export function getStoredRepoRoute(
  repo: RepoConfigRecord,
): ModelRouteConfig | null {
  if (!hasStoredModelStrategy(repo)) return null;

  return {
    main: repo.mainModel ?? null,
    fallbacks: repo.fallbackModels ?? [],
    size_overrides: Array.isArray(repo.sizeOverrides) ? repo.sizeOverrides : [],
  };
}

export function hasMeaningfulCustomStrategy(
  repo: RepoConfigRecord,
  globalConfig: GlobalModelConfig | ModelRouteConfig | null,
) {
  const storedRoute = getStoredRepoRoute(repo);
  if (!storedRoute) return false;

  return (
    !routesEqual(storedRoute, getGlobalRoute(globalConfig)) &&
    !routesEqual(storedRoute, EMPTY_MODEL_ROUTE)
  );
}

export function getRepoRoute(
  repo: RepoConfigRecord,
  globalConfig: GlobalModelConfig | ModelRouteConfig | null,
): ModelRouteConfig {
  if (!hasMeaningfulCustomStrategy(repo, globalConfig)) {
    return getGlobalRoute(globalConfig);
  }

  return getStoredRepoRoute(repo) ?? getGlobalRoute(globalConfig);
}

export function formatLastActivity(value: string | Date | null) {
  if (!value) return null;
  // Rendered in the account's display time zone (UTC unless changed in settings).
  return formatDateTime(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
