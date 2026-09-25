import type { AppBindingsConfig } from "./service";
import { withTimeout } from "@codraoss/core/timeout";
import {
  GitHubError,
  assertResponseOk,
  type GitHubRequestContext,
  encodeGitHubContentPath,
  repoApiPath,
  withRetry,
} from "./http";
import {
  GITHUB_TIMEOUT_MS,
  GITHUB_REPOSITORIES_PER_PAGE,
  GITHUB_REPOSITORY_PAGE_LIMIT,
} from "./constants";
import {
  fetchAppInstallationUrl,
  fetchInstallationToken,
  fetchInstallations,
  readCachedInstallationToken,
  writeCachedInstallationToken,
} from "./app-auth";
import { fetchCompareDiff, fetchPullRequestDiff } from "./diff-fetch";
import { findBotReviewForCommit, postReview } from "./review-post";
import {
  addIssueLabels,
  ensureLabel,
  listIssueLabels,
  removeIssueLabel,
} from "./labels";
import { addIssueReaction } from "./reactions";
import type {
  GitHubInstallation,
  GitHubRepository,
  ReviewComment,
  PullRequestRecord,
  InstallationTokenCacheRecord,
} from "./types";

// Mock seam: replaced in tests via vi.mock. Enforces module boundary.
export type { GitHubInstallation, GitHubRepository, ReviewComment };
export { GitHubError };

export class GitHubClient {
  constructor(
    private env: AppBindingsConfig,
    private readonly installationId?: string,
    private readonly tracker?: { incrementSubrequests(count?: number): void },
  ) {}

  // Scoped per invocation to avoid KV hits & 50-subrequest cap.
  private memoToken: InstallationTokenCacheRecord | null = null;

  async getInstallationToken(): Promise<string> {
    if (!this.installationId) {
      throw new GitHubError(
        400,
        "Missing installation ID",
        "getInstallationToken",
        "Cannot fetch installation token without an installation ID.",
      );
    }
    const installationId = this.installationId; // Type narrowed to string here

    // Reuse the in-memory token while comfortably unexpired.
    if (
      this.memoToken?.token &&
      new Date(this.memoToken.expiresAt).getTime() > Date.now() + 60_000
    ) {
      return this.memoToken.token;
    }

    const cached = await readCachedInstallationToken(
      this.env,
      installationId,
      this.tracker,
    );
    if (cached?.token) {
      this.memoToken = cached;
      return cached.token;
    }

    return withRetry("getInstallationToken", async () => {
      const record = await fetchInstallationToken(this.env, installationId);
      await writeCachedInstallationToken(
        this.env,
        installationId,
        record,
        this.tracker,
      );
      this.memoToken = record;

      return record.token;
    });
  }

  static async listInstallations(
    env: AppBindingsConfig,
  ): Promise<GitHubInstallation[]> {
    return fetchInstallations(env);
  }

  static async getAppInstallationUrl(env: AppBindingsConfig): Promise<string> {
    return fetchAppInstallationUrl(env);
  }

  async listRepositories(): Promise<GitHubRepository[]> {
    return withRetry("listRepositories", async () => {
      const repositories: GitHubRepository[] = [];

      for (let page = 1; page <= GITHUB_REPOSITORY_PAGE_LIMIT; page += 1) {
        const response = await this.requestAndCheck(
          `/installation/repositories?per_page=${GITHUB_REPOSITORIES_PER_PAGE}&page=${page}`,
        );
        const data = (await response.json()) as {
          repositories: GitHubRepository[];
        };
        repositories.push(...data.repositories);

        if (data.repositories.length < GITHUB_REPOSITORIES_PER_PAGE) {
          return repositories;
        }
      }

      throw new Error(
        `GitHub repository listing exceeded ${GITHUB_REPOSITORY_PAGE_LIMIT} pages without a terminating page.`,
      );
    });
  }

  private async request(
    path: string,
    init: RequestInit = {},
    accept = "application/vnd.github+json",
  ): Promise<Response> {
    const token = await this.getInstallationToken();

    if (this.tracker) this.tracker.incrementSubrequests(1);
    return withTimeout(
      `GitHub ${init.method ?? "GET"} ${path}`,
      GITHUB_TIMEOUT_MS,
      (signal) =>
        fetch(`https://api.github.com${path}`, {
          ...init,
          signal,
          headers: {
            Accept: accept,
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": this.env.BOT_USERNAME ?? "codra-bot",
            ...init.headers,
          },
        }),
    );
  }

  private async requestAndCheck(
    path: string,
    init: RequestInit = {},
    accept = "application/vnd.github+json",
  ): Promise<Response> {
    const response = await this.request(path, init, accept);
    await assertResponseOk(
      response,
      path,
      `GitHub API ${init.method ?? "GET"} ${path}`,
    );
    return response;
  }

  // Hands the extracted helpers the authenticated-request surface.
  private ctx(): GitHubRequestContext {
    return {
      request: (path, init, accept) => this.request(path, init, accept),
      requestAndCheck: (path, init, accept) =>
        this.requestAndCheck(path, init, accept),
    };
  }

  async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    return withRetry("graphql", async () => {
      const token = await this.getInstallationToken();

      if (this.tracker) this.tracker.incrementSubrequests(1);
      const response = await withTimeout(
        "GitHub GraphQL",
        GITHUB_TIMEOUT_MS,
        (signal) =>
          fetch("https://api.github.com/graphql", {
            method: "POST",
            signal,
            headers: {
              Authorization: `Bearer ${token}`,
              "User-Agent": this.env.BOT_USERNAME ?? "codra-bot",
              "content-type": "application/json",
            },
            body: JSON.stringify({ query, variables }),
          }),
      );

      await assertResponseOk(response, "/graphql", "GitHub GraphQL request");

      const payload = (await response.json()) as {
        data?: T;
        errors?: Array<{ message: string }>;
      };
      if (payload.errors?.length) {
        throw new GitHubError(
          422,
          JSON.stringify(payload.errors),
          "/graphql",
          `GitHub GraphQL error: ${payload.errors[0].message}`,
        );
      }
      return payload.data as T;
    });
  }

  async getPullRequest(owner: string, repo: string, pullNumber: number) {
    return withRetry(
      `getPullRequest ${owner}/${repo}#${pullNumber}`,
      async () => {
        const response = await this.requestAndCheck(
          `${repoApiPath(owner, repo)}/pulls/${pullNumber}`,
        );
        return (await response.json()) as PullRequestRecord;
      },
    );
  }

  async getPullRequestDiff(owner: string, repo: string, pullNumber: number) {
    return fetchPullRequestDiff(this.ctx(), owner, repo, pullNumber);
  }

  async getCompareDiff(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ) {
    return fetchCompareDiff(this.ctx(), owner, repo, base, head);
  }

  // File content at a specific commit; without `ref`, GitHub answers from the default branch instead.
  // Never retried: a secondary rate limit here would sleep 60-120s, worse than just skipping the context.
  async getRepoFile(owner: string, repo: string, path: string, ref?: string) {
    return withRetry(
      `getRepoFile ${owner}/${repo}/${path}`,
      async () => {
        const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
        const response = await this.request(
          `${repoApiPath(owner, repo)}/contents/${encodeGitHubContentPath(path)}${query}`,
        );
        if (response.status === 404) return null;
        await assertResponseOk(response, path, "GitHub repo file fetch");

        const data = (await response.json()) as {
          content?: string;
          encoding?: string;
        };
        if (!data.content) {
          return null;
        }
        if (data.encoding !== "base64") return data.content;

        // atob alone yields one code unit per byte, mangling non-ASCII source files; decode as UTF-8 instead.
        const binary = atob(data.content.replace(/\n/g, ""));
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
      },
      0,
    );
  }

  async createCheckRun(
    owner: string,
    repo: string,
    input: {
      headSha: string;
      title: string;
      summary: string;
      detailsUrl?: string;
    },
  ) {
    return withRetry(`createCheckRun ${owner}/${repo}`, async () => {
      const response = await this.requestAndCheck(
        `${repoApiPath(owner, repo)}/check-runs`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Codra",
            head_sha: input.headSha,
            status: "in_progress",
            details_url: input.detailsUrl,
            output: {
              title: input.title,
              summary: input.summary,
            },
          }),
        },
      );

      return (await response.json()) as { id: number };
    });
  }

  async updateCheckRun(
    owner: string,
    repo: string,
    checkRunId: number,
    input: {
      title: string;
      summary: string;
      status?: "in_progress" | "completed";
      conclusion?: "success" | "neutral" | "failure" | "cancelled";
    },
  ) {
    return withRetry(
      `updateCheckRun ${owner}/${repo} ${checkRunId}`,
      async () => {
        await this.requestAndCheck(
          `${repoApiPath(owner, repo)}/check-runs/${checkRunId}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              status: input.status ?? "in_progress",
              conclusion: input.conclusion,
              completed_at:
                input.status === "completed"
                  ? new Date().toISOString()
                  : undefined,
              output: {
                title: input.title,
                summary: input.summary,
              },
            }),
          },
        );
      },
    );
  }

  async createReview(
    owner: string,
    repo: string,
    pullNumber: number,
    input: {
      commitSha: string;
      event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
      body: string;
      comments: ReviewComment[];
    },
  ) {
    return postReview(this.ctx(), owner, repo, pullNumber, input);
  }

  async findBotReviewForCommit(
    owner: string,
    repo: string,
    pullNumber: number,
    commitSha: string,
    botLogin: string,
  ): Promise<{ id: number } | null> {
    return findBotReviewForCommit(
      this.ctx(),
      owner,
      repo,
      pullNumber,
      commitSha,
      botLogin,
    );
  }

  async ensureLabel(owner: string, repo: string, name: string, color: string) {
    return ensureLabel(this.ctx(), owner, repo, name, color);
  }

  async addIssueLabels(
    owner: string,
    repo: string,
    issueNumber: number,
    labels: string[],
  ) {
    return addIssueLabels(this.ctx(), owner, repo, issueNumber, labels);
  }

  async addIssueReaction(
    owner: string,
    repo: string,
    issueNumber: number,
    content: "+1",
  ) {
    return addIssueReaction(this.ctx(), owner, repo, issueNumber, content);
  }

  async listIssueLabels(owner: string, repo: string, issueNumber: number) {
    return listIssueLabels(this.ctx(), owner, repo, issueNumber);
  }

  // Case-insensitive removal using stored casing.
  async removeIssueLabelsIfPresent(
    owner: string,
    repo: string,
    issueNumber: number,
    labels: string[],
  ) {
    const currentLabels = await this.listIssueLabels(owner, repo, issueNumber);
    const currentByLowerName = new Map(
      currentLabels.map((label) => [label.toLowerCase(), label]),
    );

    const uniqueLabels = Array.from(
      new Set(labels.map((label) => label.toLowerCase())),
    );
    for (const label of uniqueLabels) {
      const currentLabel = currentByLowerName.get(label);
      if (currentLabel) {
        await this.removeIssueLabel(owner, repo, issueNumber, currentLabel);
      }
    }
  }

  async removeIssueLabel(
    owner: string,
    repo: string,
    issueNumber: number,
    label: string,
  ) {
    return removeIssueLabel(this.ctx(), owner, repo, issueNumber, label);
  }
}
