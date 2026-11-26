import { normalizeGitHubWebhook } from "@codraoss/provider-github";
import { describe, expect, it } from "vitest";

const repository = {
  owner: { login: "octocat" },
  name: "hello-world",
};

describe("normalizeGitHubWebhook", () => {
  it("maps issue_comment to the normalized comment event", () => {
    const payload = {
      action: "created",
      installation: { id: 123 },
      repository,
      issue: {
        number: 27,
        pull_request: {
          url: "https://api.github.com/repos/octocat/hello-world/pulls/27",
        },
      },
      comment: { body: "@codra-app review" },
    };

    expect(normalizeGitHubWebhook("issue_comment", payload)).toEqual({
      eventName: "comment",
      payload: {
        action: "created",
        installationId: "123",
        repository: { owner: "octocat", name: "hello-world" },
        issue: { number: 27, isChangeRequest: true },
        comment: { body: "@codra-app review" },
      },
    });
  });

  it("maps pull_request to the normalized change_request event", () => {
    const payload = {
      action: "closed",
      installation: { id: 123 },
      repository,
      pull_request: {
        number: 31,
        title: "Closed pull request",
        body: null,
        user: { login: "octocat" },
        head: { sha: "h".repeat(40), ref: "feature" },
        base: { sha: "b".repeat(40), ref: "main" },
        draft: false,
      },
    };

    expect(normalizeGitHubWebhook("pull_request", payload)).toEqual({
      eventName: "change_request",
      payload: {
        action: "closed",
        installationId: "123",
        repository: { owner: "octocat", name: "hello-world" },
        changeRequest: {
          number: 31,
          title: "Closed pull request",
          author: "octocat",
          head: { sha: "h".repeat(40), ref: "feature" },
          base: { sha: "b".repeat(40), ref: "main" },
          draft: false,
          body: null,
        },
      },
    });
  });

  it("returns null for unsupported webhook events", () => {
    expect(normalizeGitHubWebhook("check_suite", {})).toBeNull();
  });
});
