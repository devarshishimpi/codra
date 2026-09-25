import {
  assertResponseOk,
  type GitHubRequestContext,
  repoApiPath,
  withRetry,
} from "./http";
import type { GitHubIssueLabel } from "./types";

export async function ensureLabel(
  ctx: GitHubRequestContext,
  owner: string,
  repo: string,
  name: string,
  color: string,
) {
  return withRetry(`ensureLabel ${owner}/${repo} ${name}`, async () => {
    const listResponse = await ctx.request(
      `${repoApiPath(owner, repo)}/labels/${encodeURIComponent(name)}`,
    );
    if (listResponse.ok) return;

    if (listResponse.status !== 404) {
      await assertResponseOk(listResponse, name, "GitHub label lookup");
    }

    const createResponse = await ctx.request(
      `${repoApiPath(owner, repo)}/labels`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name, color }),
      },
    );

    // 422: already exists (concurrent job).
    if (!createResponse.ok && createResponse.status !== 422) {
      await assertResponseOk(createResponse, name, "GitHub label creation");
    }
  });
}

export async function addIssueLabels(
  ctx: GitHubRequestContext,
  owner: string,
  repo: string,
  issueNumber: number,
  labels: string[],
) {
  return withRetry(
    `addIssueLabels ${owner}/${repo}#${issueNumber}`,
    async () => {
      await ctx.requestAndCheck(
        `${repoApiPath(owner, repo)}/issues/${issueNumber}/labels`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ labels }),
        },
      );
    },
  );
}

export async function listIssueLabels(
  ctx: GitHubRequestContext,
  owner: string,
  repo: string,
  issueNumber: number,
) {
  return withRetry(
    `listIssueLabels ${owner}/${repo}#${issueNumber}`,
    async () => {
      const response = await ctx.requestAndCheck(
        `${repoApiPath(owner, repo)}/issues/${issueNumber}/labels?per_page=100`,
      );
      const labels = await response.json();
      if (!Array.isArray(labels)) {
        throw new Error("Expected an array of labels from GitHub API.");
      }
      return labels
        .map((label: GitHubIssueLabel) => label.name)
        .filter(
          (name): name is string => typeof name === "string" && name.length > 0,
        );
    },
  );
}

export async function removeIssueLabel(
  ctx: GitHubRequestContext,
  owner: string,
  repo: string,
  issueNumber: number,
  label: string,
) {
  return withRetry(
    `removeIssueLabel ${owner}/${repo}#${issueNumber} ${label}`,
    async () => {
      const response = await ctx.request(
        `${repoApiPath(owner, repo)}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok && response.status !== 404) {
        await assertResponseOk(response, label, "GitHub label removal");
      }
    },
  );
}
