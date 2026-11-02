import { logger } from "@codraoss/core/logger";
import {
  buildUnifiedDiffFromFiles,
  type DiffFileEntry,
} from "@codraoss/core/diff";
import {
  type GitHubRequestContext,
  isDiffTooLargeError,
  repoApiPath,
  withRetry,
} from "./http";
import { DIFF_FILES_PER_PAGE, MAX_DIFF_FILE_PAGES } from "./constants";

// Internal implementation. Class stays the mockable seam.

// Rebuild diff if >20k lines (406 too_large).
async function fetchPullRequestDiffFromFiles(
  ctx: GitHubRequestContext,
  owner: string,
  repo: string,
  pullNumber: number,
) {
  const files: DiffFileEntry[] = [];

  // Bounded budget of ~25 subrequests. 5 pages = 500 files limit.
  for (let page = 1; page <= MAX_DIFF_FILE_PAGES; page++) {
    const pageFiles = await withRetry(
      `getPullRequestFiles ${owner}/${repo}#${pullNumber} p${page}`,
      async () => {
        const response = await ctx.requestAndCheck(
          `${repoApiPath(owner, repo)}/pulls/${pullNumber}/files?per_page=${DIFF_FILES_PER_PAGE}&page=${page}`,
        );
        return (await response.json()) as DiffFileEntry[];
      },
    );

    files.push(...pageFiles);
    if (pageFiles.length < DIFF_FILES_PER_PAGE) break;

    if (page === MAX_DIFF_FILE_PAGES) {
      logger.warn(
        `Stopped rebuilding the diff for ${owner}/${repo}#${pullNumber} at ${files.length} files; later files are not reviewed`,
      );
    }
  }

  return buildUnifiedDiffFromFiles(files);
}

export async function fetchPullRequestDiff(
  ctx: GitHubRequestContext,
  owner: string,
  repo: string,
  pullNumber: number,
) {
  try {
    return await withRetry(
      `getPullRequestDiff ${owner}/${repo}#${pullNumber}`,
      async () => {
        const response = await ctx.requestAndCheck(
          `${repoApiPath(owner, repo)}/pulls/${pullNumber}`,
          {},
          "application/vnd.github.v3.diff",
        );
        return response.text();
      },
    );
  } catch (error) {
    if (!isDiffTooLargeError(error)) throw error;
    logger.warn(
      `Diff for ${owner}/${repo}#${pullNumber} exceeds GitHub's 20,000-line media-type cap; rebuilding it from the per-file endpoint`,
    );
    return fetchPullRequestDiffFromFiles(ctx, owner, repo, pullNumber);
  }
}

// Diff between commits, reconstructs expired KV cache.
export async function fetchCompareDiff(
  ctx: GitHubRequestContext,
  owner: string,
  repo: string,
  base: string,
  head: string,
) {
  const comparePath = `${repoApiPath(owner, repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  try {
    return await withRetry(
      `getCompareDiff ${owner}/${repo} ${base}...${head}`,
      async () => {
        const response = await ctx.requestAndCheck(
          comparePath,
          {},
          "application/vnd.github.v3.diff",
        );
        return response.text();
      },
    );
  } catch (error) {
    if (!isDiffTooLargeError(error)) throw error;
    // Best-effort diff rebuild via JSON file list (max 300 files).
    logger.warn(
      `Compare diff ${owner}/${repo} ${base}...${head} is over the line cap; rebuilding from the JSON file list`,
    );
    return withRetry(
      `getCompareFiles ${owner}/${repo} ${base}...${head}`,
      async () => {
        const response = await ctx.requestAndCheck(comparePath);
        const payload = (await response.json()) as { files?: DiffFileEntry[] };
        return buildUnifiedDiffFromFiles(payload.files ?? []);
      },
    );
  }
}
