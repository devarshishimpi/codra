import { GitHubClient } from "./client";
import type { ReviewComment } from "./types";

export type AppBindingsConfig = {
  APP_KV: {
    get: (key: string, type?: any) => Promise<any | null>;
    put: (key: string, value: string, opts?: any) => Promise<void>;
  };
  APP_PRIVATE_KEY: string;
  GITHUB_APP_ID: string;
  BOT_USERNAME?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  AUTH_CALLBACK_URL?: string;
};

export class GitHubService {
  private client: GitHubClient;

  constructor(
    env: AppBindingsConfig,
    installationId: string,
    tracker?: { incrementSubrequests(count?: number): void },
  ) {
    this.client = new GitHubClient(env, installationId, tracker);
  }

  async getPullRequest(owner: string, repo: string, prNumber: number) {
    return this.client.getPullRequest(owner, repo, prNumber);
  }

  async getPullRequestDiff(owner: string, repo: string, prNumber: number) {
    return this.client.getPullRequestDiff(owner, repo, prNumber);
  }

  async getCompareDiff(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ) {
    return this.client.getCompareDiff(owner, repo, base, head);
  }

  async getRepoFile(owner: string, repo: string, path: string, ref?: string) {
    return this.client.getRepoFile(owner, repo, path, ref);
  }

  async createCheckRun(
    owner: string,
    repo: string,
    params: { headSha: string; title: string; summary: string },
  ) {
    return this.client.createCheckRun(owner, repo, params);
  }

  async updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    params: {
      title: string;
      summary: string;
      status?: "in_progress" | "completed";
      conclusion?: "success" | "neutral" | "failure" | "cancelled";
    },
  ) {
    return this.client.updateCheckRun(owner, repo, checkRunId, params);
  }

  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    params: {
      commitSha: string;
      event: "APPROVE" | "COMMENT";
      body: string;
      comments: ReviewComment[];
    },
  ) {
    return this.client.createReview(owner, repo, prNumber, params);
  }

  async findBotReviewForCommit(
    owner: string,
    repo: string,
    prNumber: number,
    commitSha: string,
    botLogin: string,
  ) {
    return this.client.findBotReviewForCommit(
      owner,
      repo,
      prNumber,
      commitSha,
      botLogin,
    );
  }

  async ensureLabel(owner: string, repo: string, name: string, color: string) {
    return this.client.ensureLabel(owner, repo, name, color);
  }

  async addIssueLabels(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[],
  ) {
    return this.client.addIssueLabels(owner, repo, prNumber, labels);
  }

  async addIssueReaction(
    owner: string,
    repo: string,
    prNumber: number,
    content: "+1",
  ) {
    return this.client.addIssueReaction(owner, repo, prNumber, content);
  }

  async removeIssueLabelsIfPresent(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[],
  ) {
    return this.client.removeIssueLabelsIfPresent(
      owner,
      repo,
      prNumber,
      labels,
    );
  }

  async removeIssueLabel(
    owner: string,
    repo: string,
    prNumber: number,
    label: string,
  ) {
    return this.client.removeIssueLabel(owner, repo, prNumber, label);
  }
}
