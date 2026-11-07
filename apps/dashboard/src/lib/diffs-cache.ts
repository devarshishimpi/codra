import { isJsonWithinBudget } from "./json-size";

/**
 * Session cache for a job's per-file diffs, shared by the Files-changed tab and the Logs page so
 * switching between them doesn't refetch (`diff_input` isn't persisted in Postgres - see
 * GET /api/jobs/:id/diffs - so both fetch it lazily).
 */

const cacheKey = (jobId: string) => `codra:job-diffs:${jobId}`;

const MAX_CACHED_CHARS = 2_000_000;
export const DIFFS_CACHE_FRESH_MS = 30_000;

export interface DiffsCacheEntry {
  diffs: Record<string, string>;
  savedAt: number;
}

function isDiffMap(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

export function isDiffsCacheFresh(
  entry: DiffsCacheEntry | null,
  now = Date.now(),
) {
  return (
    !!entry &&
    entry.savedAt > 0 &&
    entry.savedAt <= now + 60_000 &&
    now - entry.savedAt <= DIFFS_CACHE_FRESH_MS
  );
}

export function readDiffsCache(jobId: string): DiffsCacheEntry | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(jobId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "version" in parsed &&
      parsed.version === 1 &&
      "savedAt" in parsed &&
      typeof parsed.savedAt === "number" &&
      "diffs" in parsed &&
      isDiffMap(parsed.diffs)
    ) {
      return { diffs: parsed.diffs, savedAt: parsed.savedAt };
    }
    // Older cache entries stored the diff map directly; display them once and
    // refresh because their age is unknown.
    return isDiffMap(parsed) ? { diffs: parsed, savedAt: 0 } : null;
  } catch {
    return null;
  }
}

export function writeDiffsCache(jobId: string, diffs: Record<string, string>) {
  try {
    const entry = { version: 1, savedAt: Date.now(), diffs };
    if (!isJsonWithinBudget(entry, MAX_CACHED_CHARS)) return;
    const payload = JSON.stringify(entry);
    if (payload.length > MAX_CACHED_CHARS) return;
    sessionStorage.setItem(cacheKey(jobId), payload);
  } catch {
    /* quota exceeded / unavailable - skip */
  }
}
