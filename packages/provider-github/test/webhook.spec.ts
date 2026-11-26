import { describe, expect, it } from "vitest";
import { normalizeGitHubWebhook } from "../src/webhook";

describe("normalizeGitHubWebhook", () => {
  it("normalizes raw pull_request webhook payload", () => {
    const rawPayload = {
      action: "opened",
      installation: { id: 98765 },
      repository: {
        owner: { login: "codraoss" },
        name: "codra",
      },
      pull_request: {
        number: 101,
        title: "PR Title",
        user: { login: "dev-user" },
        head: { sha: "head123", ref: "feature" },
        base: { sha: "base123", ref: "main" },
        draft: false,
        body: "PR description",
      },
    };

    const result = normalizeGitHubWebhook("pull_request", rawPayload);
    expect(result).toEqual({
      eventName: "change_request",
      payload: {
        action: "opened",
        installationId: "98765",
        repository: {
          owner: "codraoss",
          name: "codra",
        },
        changeRequest: {
          number: 101,
          title: "PR Title",
          author: "dev-user",
          head: { sha: "head123", ref: "feature" },
          base: { sha: "base123", ref: "main" },
          draft: false,
          body: "PR description",
        },
      },
    });
  });

  it("normalizes raw issue_comment webhook payload", () => {
    const rawPayload = {
      action: "created",
      installation: { id: 98765 },
      repository: {
        owner: { login: "codraoss" },
        name: "codra",
      },
      issue: {
        number: 101,
        pull_request: { url: "https://api.github.com/repos/codraoss/codra/pulls/101" },
      },
      comment: {
        body: "@codra review",
      },
    };

    const result = normalizeGitHubWebhook("issue_comment", rawPayload);
    expect(result).toEqual({
      eventName: "comment",
      payload: {
        action: "created",
        installationId: "98765",
        repository: {
          owner: "codraoss",
          name: "codra",
        },
        issue: {
          number: 101,
          isChangeRequest: true,
        },
        comment: {
          body: "@codra review",
        },
      },
    });
  });

  it("handles canonical event names and already-normalized payloads", () => {
    const crPayload = {
      action: "opened" as const,
      installationId: "123",
      repository: { owner: "owner", name: "repo" },
      changeRequest: {
        number: 1,
        title: "Title",
        author: "author",
        head: { sha: "h", ref: "hr" },
        base: { sha: "b", ref: "br" },
        draft: false,
        body: null,
      },
    };
    expect(normalizeGitHubWebhook("change_request", crPayload)).toEqual({
      eventName: "change_request",
      payload: crPayload,
    });

    const commentPayload = {
      action: "created" as const,
      installationId: "123",
      repository: { owner: "owner", name: "repo" },
      issue: { number: 1, isChangeRequest: true },
      comment: { body: "@codra review" },
    };
    expect(normalizeGitHubWebhook("comment", commentPayload)).toEqual({
      eventName: "comment",
      payload: commentPayload,
    });
  });

  it("returns null for unsupported events", () => {
    expect(normalizeGitHubWebhook("check_suite", {})).toBeNull();
    expect(normalizeGitHubWebhook("push", {})).toBeNull();
  });
});
