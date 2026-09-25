/** Maps to GitHub Pull Request, GitLab Merge Request, etc. */
export type PullRequestRecord = {
  number: number;
  title: string | null;
  body: string | null;
  draft: boolean;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
  user: { login: string };
};

export type ReviewComment = {
  path: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  position?: number;
  body: string;
};

/** @see ReviewGitProvider — the GitHub adapter's name for this port */
export interface ReviewGitProvider {
  getPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequestRecord>;
  getPullRequestDiff(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<string>;
  getCompareDiff(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<string>;
  /** File content at `ref`, or null if unavailable. Optional: backs opt-in file-context enrichment. */
  getRepoFile?(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null>;
  createCheckRun(
    owner: string,
    repo: string,
    params: { headSha: string; title: string; summary: string },
  ): Promise<{ id: number }>;
  updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    params: {
      title: string;
      summary: string;
      status?: "in_progress" | "completed";
      conclusion?: "success" | "neutral" | "failure" | "cancelled";
    },
  ): Promise<unknown>;
  createReview(
    owner: string,
    repo: string,
    prNumber: number,
    params: {
      commitSha: string;
      event: "APPROVE" | "COMMENT";
      body: string;
      comments: ReviewComment[];
    },
  ): Promise<{ id: number; postedIndices?: number[] }>;
  findBotReviewForCommit(
    owner: string,
    repo: string,
    prNumber: number,
    commitSha: string,
    botLogin: string,
  ): Promise<{ id: number } | null>;
  ensureLabel(
    owner: string,
    repo: string,
    name: string,
    color: string,
  ): Promise<unknown>;
  addIssueLabels(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[],
  ): Promise<unknown>;
  /** Optional: a provider or test double without it simply does not react. */
  addIssueReaction?(
    owner: string,
    repo: string,
    prNumber: number,
    content: "+1",
  ): Promise<unknown>;
  removeIssueLabelsIfPresent(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[],
  ): Promise<unknown>;
}

import type { TokenTracker } from "../token-tracker";

export interface GitProviderFactory {
  forInstallation(
    installationId: string,
    tracker?: TokenTracker,
  ): ReviewGitProvider;
}
