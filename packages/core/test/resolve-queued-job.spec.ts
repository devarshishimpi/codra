import { defaultRepoConfig, type ReviewJobMessage } from "@codraoss/schema";
import { normalizeGitHubWebhook } from "@codraoss/provider-github";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLoggerSink } from "../src/logger";
import type { ReviewRuntime } from "../src/ports";
import { resolveQueuedJob } from "../src/review/resolve-job";
import { createInMemoryRuntime, makeJob } from "./in-memory";

const repository = {
  owner: { login: "octocat" },
  name: "hello-world",
};

function createRuntimeForDelivery(
  eventName: string,
  payload: unknown,
  config = defaultRepoConfig,
) {
  const { runtime } = createInMemoryRuntime({ config });
  const normalizePayload = vi.fn(normalizeGitHubWebhook);

  runtime.webhooks = {
    getWebhookDelivery: async (deliveryId) => ({
      delivery_id: deliveryId,
      event_name: eventName,
      payload,
    }),
    normalizePayload,
  };

  const insertedJobs: Array<Parameters<ReviewRuntime["jobs"]["insertJob"]>[0]> =
    [];
  runtime.jobs.findExistingJobForHead = async () => null;
  runtime.jobs.insertJob = async (input) => {
    insertedJobs.push(input);
    return makeJob();
  };
  runtime.jobs.supersedeOlderJobs = async () => 0;

  return { runtime, insertedJobs, normalizePayload };
}

describe("resolveQueuedJob webhook normalization", () => {
  beforeEach(() => {
    setLoggerSink({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    });
  });

  it("resolves a raw issue_comment delivery into a mention-triggered review job", async () => {
    const rawPayload = {
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
    const { runtime, insertedJobs, normalizePayload } =
      createRuntimeForDelivery("issue_comment", rawPayload);

    const pullRequest = {
      number: 27,
      title: "Fix queue processing",
      body: null,
      draft: false,
      head: { sha: "h".repeat(40), ref: "fix/queue" },
      base: { sha: "b".repeat(40), ref: "main" },
      user: { login: "octocat" },
    };
    const getPullRequest = vi.fn(async () => pullRequest);
    runtime.githubClients = {
      forInstallation: vi.fn(() => ({ getPullRequest }) as never),
    };

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "delivery-issue-comment",
      eventName: "issue_comment",
    } as ReviewJobMessage);

    expect(normalizePayload).toHaveBeenCalledWith("issue_comment", rawPayload);
    expect(getPullRequest).toHaveBeenCalledWith("octocat", "hello-world", 27);
    expect(insertedJobs).toHaveLength(1);
    expect(insertedJobs[0]).toMatchObject({
      installationId: "123",
      owner: "octocat",
      repo: "hello-world",
      prNumber: 27,
      prTitle: "Fix queue processing",
      prAuthor: "octocat",
      commitSha: "h".repeat(40),
      baseSha: "b".repeat(40),
      headRef: "fix/queue",
      baseRef: "main",
      trigger: "mention",
    });
    expect(result).toMatchObject({ phase: "prepare" });
  });

  it("normalizes pull_request.closed before cleaning review labels", async () => {
    const labels = { p1: "review:p1", p2: "review:p2", p3: "review:p3" };
    const config = {
      ...defaultRepoConfig,
      review: { ...defaultRepoConfig.review, labels },
    };
    const rawPayload = {
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
    const { runtime, insertedJobs, normalizePayload } =
      createRuntimeForDelivery("pull_request", rawPayload, config);
    const removeIssueLabelsIfPresent = vi.fn(async () => undefined);
    runtime.githubClients = {
      forInstallation: vi.fn(() => ({ removeIssueLabelsIfPresent }) as never),
    };

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "delivery-pull-request-closed",
      eventName: "pull_request",
    } as ReviewJobMessage);

    expect(normalizePayload).toHaveBeenCalledWith("pull_request", rawPayload);
    expect(removeIssueLabelsIfPresent).toHaveBeenCalledWith(
      "octocat",
      "hello-world",
      31,
      ["review:p1", "review:p2", "review:p3"],
    );
    expect(insertedJobs).toHaveLength(0);
    expect(result).toBeNull();
  });

  it("keeps normalized pull-request events eligible for automatic reviews", async () => {
    const rawPayload = {
      action: "opened",
      installation: { id: 123 },
      repository,
      pull_request: {
        number: 42,
        prTitle: "Add automatic review",
        body: null,
        user: { login: "octocat" },
        head: { sha: "a".repeat(40), ref: "feature" },
        base: { sha: "b".repeat(40), ref: "main" },
        draft: false,
      },
    };
    const { runtime, insertedJobs, normalizePayload } =
      createRuntimeForDelivery("pull_request", rawPayload);
    runtime.githubClients = {
      forInstallation: vi.fn(() => ({} as never)),
    };

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "delivery-pull-request-opened",
      eventName: "pull_request",
    } as ReviewJobMessage);

    expect(normalizePayload).toHaveBeenCalledWith("pull_request", rawPayload);
    expect(insertedJobs).toHaveLength(1);
    expect(insertedJobs[0]).toMatchObject({
      installationId: "123",
      owner: "octocat",
      repo: "hello-world",
      prNumber: 42,
      title: "Add automatic review",
      commitSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      trigger: "auto",
    });
    expect(result).toMatchObject({ phase: "prepare" });
  });
});
