import { defaultRepoConfig, normalizeRepoModelConfig, repoConfigSchema, type RepoConfig } from '@codraoss/schema';
import { REPO_CONFIG_CACHE_VERSION } from '@codraoss/schema';
import { getRepoConfigRecord, syncRepoConfig } from '@codraoss/db/repo-configs';
import type { DbEnv } from '@codraoss/db/env';
import type { KvCompat } from './kv';

export type { KvCompat };

type CachedConfig = {
  parsedJson: RepoConfig;
  enabled: boolean;
};

const REPO_CONFIG_CACHE_PREFIX = `config:${REPO_CONFIG_CACHE_VERSION}:db:`;
const REPO_CONFIG_REVISION_KEY = `config:${REPO_CONFIG_CACHE_VERSION}:db_revision`;

async function getRepoConfigCacheRevision(kv: KvCompat) {
  return (await kv.get(REPO_CONFIG_REVISION_KEY)) ?? '0';
}

async function cacheKey(kv: KvCompat, owner: string, repo: string) {
  const revision = await getRepoConfigCacheRevision(kv);
  return `${REPO_CONFIG_CACHE_PREFIX}${revision}:${owner}/${repo}`;
}

const GLOBAL_CONFIG_KEY = 'config:global_model';

const EMPTY_GLOBAL_CONFIG: RepoConfig['model'] = {
  main: null,
  fallbacks: [],
  size_overrides: [],
};

function hasRepoModelOverride(existing: Awaited<ReturnType<typeof getRepoConfigRecord>> | null) {
  return Boolean(
    existing?.mainModel ||
    (Array.isArray(existing?.fallbackModels) && existing.fallbackModels.length > 0) ||
    (Array.isArray(existing?.sizeOverrides) && existing.sizeOverrides.length > 0),
  );
}

export async function getGlobalConfig(kv: KvCompat): Promise<RepoConfig['model']> {
  const cached = await kv.get(GLOBAL_CONFIG_KEY, 'json');
  if (cached) {
    const parsed = repoConfigSchema.shape.model.safeParse(cached);
    if (parsed.success) {
      return normalizeRepoModelConfig(parsed.data);
    }
  }

  return EMPTY_GLOBAL_CONFIG;
}

export async function updateGlobalConfig(kv: KvCompat, config: RepoConfig['model']) {
  await kv.put(GLOBAL_CONFIG_KEY, JSON.stringify(normalizeRepoModelConfig(config)));
  await invalidateAllRepoConfigCache(kv);
}

export async function invalidateRepoConfigCache(kv: KvCompat, owner: string, repo: string) {
  await kv.delete(await cacheKey(kv, owner, repo));
}

async function invalidateAllRepoConfigCache(kv: KvCompat) {
  await kv.put(REPO_CONFIG_REVISION_KEY, String(Date.now()));
}


export async function loadRepoConfig(
  kv: KvCompat,
  db: DbEnv,
  input: { installationId: string; owner: string; repo: string },
) {
  const key = await cacheKey(kv, input.owner, input.repo);
  const cached = await kv.get(key, 'json');
  if (cached) {
    return cached as CachedConfig;
  }

  const existing = await getRepoConfigRecord(db, input.owner, input.repo);

  let parsedJson = existing?.parsedJson ?? defaultRepoConfig;
  const enabled = existing?.enabled ?? true;

  if (!hasRepoModelOverride(existing)) {
    const globalModel = await getGlobalConfig(kv);
    parsedJson = {
      ...parsedJson,
      model: globalModel
    };
  }

  const finalConfig: CachedConfig = {
    parsedJson,
    enabled,
  };

  await kv.put(key, JSON.stringify(finalConfig), { expirationTtl: 60 * 10 });

  if (!existing) {
    await syncRepoConfig(db, input);
  }

  return finalConfig;
}
