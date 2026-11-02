import { reviewMaxFilesRange, type RepoConfig } from "@codraoss/schema";
import {
  filterReviewableFiles,
  parseUnifiedDiff,
  type FileDiff,
} from "../diff";
import type { ReviewGitProvider, ReviewRuntime } from "../ports";
import { logger } from "../logger";

import { DIFF_CACHE_TTL_SECONDS } from "../constants";

export function diffCacheKey(jobId: string) {
  return `diff:${jobId}`;
}

export async function getDiffFiles(
  env: Pick<ReviewRuntime, "kv">,
  job: { id: string; owner: string; repo: string; prNumber: number },
  github: Pick<ReviewGitProvider, "getPullRequestDiff">,
  config: RepoConfig,
  maxFiles: number = reviewMaxFilesRange.default,
): Promise<{ files: FileDiff[]; skipped: number }> {
  const cacheKey = diffCacheKey(job.id);
  let rawDiff = await env.kv.get(cacheKey);

  if (!rawDiff) {
    rawDiff = await github.getPullRequestDiff(
      job.owner,
      job.repo,
      job.prNumber,
    );
    try {
      await env.kv.put(cacheKey, rawDiff, {
        expirationTtl: DIFF_CACHE_TTL_SECONDS,
      });
    } catch (error) {
      logger.warn(
        `Failed to cache PR diff for job ${job.id}; it will be re-fetched on the next phase`,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  return filterReviewableFiles(
    parseUnifiedDiff(rawDiff, config.review),
    config.review,
    maxFiles,
  );
}

export async function getOrFetchRawDiffForCompletedJob(
  env: Pick<ReviewRuntime, "kv">,
  job: {
    id: string;
    owner: string;
    repo: string;
    baseSha: string;
    commitSha: string;
  },
  github: Pick<ReviewGitProvider, "getCompareDiff">,
): Promise<string> {
  const cacheKey = diffCacheKey(job.id);
  const cached = await env.kv.get(cacheKey);
  if (cached) return cached;

  const rawDiff = await github.getCompareDiff(
    job.owner,
    job.repo,
    job.baseSha,
    job.commitSha,
  );
  try {
    await env.kv.put(cacheKey, rawDiff, {
      expirationTtl: DIFF_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    logger.warn(
      `Failed to cache reconstructed diff for job ${job.id}`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
  return rawDiff;
}
