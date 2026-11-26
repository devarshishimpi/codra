import { describe, expect, it } from "vitest";
import { resolveQueuedJob } from "../src/review/resolve-job";
import { createInMemoryRuntime } from "./in-memory";

const MOCK_RAW_ISSUE_COMMENT_PAYLOAD = {
  action: "created",
  installation: { id: 12345 },
  repository: { name: "widgets", owner: { login: "acme" } },
  issue: { number: 42, pull_request: { url: "https://api.github.com/repos/acme/widgets/pulls/42" } },
  comment: { id: 999, body: "@codra review please check this diff" },
};

const MOCK_RAW_PULL_REQUEST_PAYLOAD = {
  action: "opened",
  installation: { id: 12345 },
  repository: { name: "widgets", owner: { login: "acme" } },
  pull_request: {
    number: 42,
    title: "Add awesome feature",
    user: { login: "octocat" },
    head: { sha: "1111111111111111111111111111111111111111", ref: "feature" },
    base: { sha: "2222222222222222222222222222222222222222", ref: "main" },
    draft: false,
    body: "PR body",
  },
};

const MOCK_PR_DATA = {
  number: 42,
  title: "Add awesome feature",
  body: "PR body",
  draft: false,
  head: { sha: "3333333333333333333333333333333333333333", ref: "feature-branch" },
  base: { sha: "4444444444444444444444444444444444444444", ref: "main" },
  user: { login: "alice" },
};

describe("resolveQueuedJob", () => {
  it("resolves mention trigger from raw issue_comment delivery record", async () => {
    const deliveries = new Map<string, any>([
      ["d-mention-1", { delivery_id: "d-mention-1", event_name: "issue_comment", payload: MOCK_RAW_ISSUE_COMMENT_PAYLOAD }],
    ]);

    const { runtime } = createInMemoryRuntime({
      noDefaultJob: true,
      deliveries,
      githubClients: {
        forInstallation: (installationId: string) => {
          expect(installationId).toBe("12345");
          return {
            getPullRequest: async (owner: string, repo: string, prNumber: number) => {
              expect(owner).toBe("acme");
              expect(repo).toBe("widgets");
              expect(prNumber).toBe(42);
              return MOCK_PR_DATA;
            },
            removeIssueLabelsIfPresent: async () => {},
          };
        },
      },
    });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-mention-1",
      eventName: "issue_comment",
    });

    expect(result).not.toBeNull();
    expect(result?.phase).toBe("prepare");
    expect(result?.job.trigger).toBe("mention");
    expect(result?.job.owner).toBe("acme");
    expect(result?.job.repo).toBe("widgets");
    expect(result?.job.prNumber).toBe(42);
    expect(result?.job.prTitle).toBe("Add awesome feature");
    expect(result?.job.prAuthor).toBe("alice");
    expect(result?.job.commitSha).toBe("3333333333333333333333333333333333333333");
  });

  it("resolves mention trigger with normalized comment event name and delivery", async () => {
    const deliveries = new Map<string, any>([
      [
        "d-comment-norm",
        {
          delivery_id: "d-comment-norm",
          event_name: "comment",
          payload: {
            action: "created",
            installationId: "12345",
            repository: { owner: "acme", name: "widgets" },
            issue: { number: 42, isChangeRequest: true },
            comment: { body: "@codra review" },
          },
        },
      ],
    ]);

    const { runtime } = createInMemoryRuntime({
      noDefaultJob: true,
      deliveries,
      githubClients: {
        forInstallation: () => ({
          getPullRequest: async () => ({
            number: 42, title: "PR Title", body: null, draft: false,
            head: { sha: "5555555555555555555555555555555555555555", ref: "feat" },
            base: { sha: "6666666666666666666666666666666666666666", ref: "main" },
            user: { login: "bob" },
          }),
          removeIssueLabelsIfPresent: async () => {},
        }),
      },
    });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-comment-norm",
      eventName: "comment",
    });

    expect(result).not.toBeNull();
    expect(result?.phase).toBe("prepare");
    expect(result?.job.trigger).toBe("mention");
    expect(result?.job.commitSha).toBe("5555555555555555555555555555555555555555");
  });

  it("resolves mention trigger when normalizePayload is explicitly provided on env.webhooks", async () => {
    const deliveries = new Map<string, any>([
      ["d-custom-norm", { delivery_id: "d-custom-norm", event_name: "issue_comment", payload: MOCK_RAW_ISSUE_COMMENT_PAYLOAD }],
    ]);

    let normalizePayloadCalled = false;
    const { runtime } = createInMemoryRuntime({
      noDefaultJob: true,
      deliveries,
      normalizePayload: (eventName, _payload) => {
        normalizePayloadCalled = true;
        expect(eventName).toBe("issue_comment");
        return {
          eventName: "comment",
          payload: {
            action: "created",
            installationId: "12345",
            repository: { owner: "acme", name: "widgets" },
            issue: { number: 42, isChangeRequest: true },
            comment: { body: "@codra review" },
          },
        };
      },
      githubClients: {
        forInstallation: () => ({
          getPullRequest: async () => ({
            number: 42, title: "PR Title", body: null, draft: false,
            head: { sha: "7777777777777777777777777777777777777777", ref: "feat" },
            base: { sha: "8888888888888888888888888888888888888888", ref: "main" },
            user: { login: "carol" },
          }),
          removeIssueLabelsIfPresent: async () => {},
        }),
      },
    });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-custom-norm",
      eventName: "issue_comment",
    });

    expect(normalizePayloadCalled).toBe(true);
    expect(result).not.toBeNull();
    expect(result?.job.trigger).toBe("mention");
  });

  it("resolves mention trigger when raw payload is passed directly in message", async () => {
    const { runtime } = createInMemoryRuntime({
      noDefaultJob: true,
      githubClients: {
        forInstallation: () => ({
          getPullRequest: async () => ({
            number: 42, title: "PR Title Direct", body: null, draft: false,
            head: { sha: "9999999999999999999999999999999999999999", ref: "feat" },
            base: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ref: "main" },
            user: { login: "dave" },
          }),
          removeIssueLabelsIfPresent: async () => {},
        }),
      },
    });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-direct",
      eventName: "issue_comment",
      payload: MOCK_RAW_ISSUE_COMMENT_PAYLOAD as any,
    });

    expect(result).not.toBeNull();
    expect(result?.job.trigger).toBe("mention");
    expect(result?.job.commitSha).toBe("9999999999999999999999999999999999999999");
  });

  it("resolves pull_request raw event name with delivery to auto-triggered job", async () => {
    const deliveries = new Map<string, any>([
      ["d-pr-1", { delivery_id: "d-pr-1", event_name: "pull_request", payload: MOCK_RAW_PULL_REQUEST_PAYLOAD }],
    ]);

    const { runtime } = createInMemoryRuntime({ noDefaultJob: true, deliveries });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-pr-1",
      eventName: "pull_request",
    });

    expect(result).not.toBeNull();
    expect(result?.phase).toBe("prepare");
    expect(result?.job.trigger).toBe("auto");
    expect(result?.job.commitSha).toBe("1111111111111111111111111111111111111111");
    expect(result?.job.prAuthor).toBe("octocat");
  });

  it("resolves change_request canonical event name with delivery to auto-triggered job", async () => {
    const deliveries = new Map<string, any>([
      [
        "d-cr-1",
        {
          delivery_id: "d-cr-1",
          event_name: "change_request",
          payload: {
            action: "opened",
            installationId: "12345",
            repository: { owner: "acme", name: "widgets" },
            changeRequest: {
              number: 42,
              title: "CR Title",
              author: "octocat",
              head: { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ref: "feat" },
              base: { sha: "cccccccccccccccccccccccccccccccccccccccc", ref: "main" },
              draft: false,
              body: "CR body",
            },
          },
        },
      ],
    ]);

    const { runtime } = createInMemoryRuntime({ noDefaultJob: true, deliveries });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-cr-1",
      eventName: "change_request",
    });

    expect(result).not.toBeNull();
    expect(result?.phase).toBe("prepare");
    expect(result?.job.trigger).toBe("auto");
    expect(result?.job.commitSha).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("ignores unsupported webhook events", async () => {
    const deliveries = new Map<string, any>([
      ["d-unsupp", { delivery_id: "d-unsupp", event_name: "check_suite", payload: { action: "completed" } }],
    ]);

    const { runtime } = createInMemoryRuntime({ deliveries });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-unsupp",
      eventName: "check_suite",
    });

    expect(result).toBeNull();
  });

  it("returns null if issue comment is on a regular issue (not a PR)", async () => {
    const deliveries = new Map<string, any>([
      [
        "d-not-pr",
        {
          delivery_id: "d-not-pr",
          event_name: "issue_comment",
          payload: {
            ...MOCK_RAW_ISSUE_COMMENT_PAYLOAD,
            issue: { number: 10 },
          },
        },
      ],
    ]);

    const { runtime } = createInMemoryRuntime({ deliveries });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-not-pr",
      eventName: "issue_comment",
    });

    expect(result).toBeNull();
  });

  it("returns null if issue comment does not contain mention trigger", async () => {
    const deliveries = new Map<string, any>([
      [
        "d-no-mention",
        {
          delivery_id: "d-no-mention",
          event_name: "issue_comment",
          payload: {
            ...MOCK_RAW_ISSUE_COMMENT_PAYLOAD,
            comment: { id: 100, body: "Looks good to me!" },
          },
        },
      ],
    ]);

    const { runtime } = createInMemoryRuntime({ deliveries });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-no-mention",
      eventName: "issue_comment",
    });

    expect(result).toBeNull();
  });

  it("returns null for draft pull requests", async () => {
    const deliveries = new Map<string, any>([
      [
        "d-draft",
        {
          delivery_id: "d-draft",
          event_name: "pull_request",
          payload: {
            ...MOCK_RAW_PULL_REQUEST_PAYLOAD,
            pull_request: {
              ...MOCK_RAW_PULL_REQUEST_PAYLOAD.pull_request,
              draft: true,
            },
          },
        },
      ],
    ]);

    const { runtime } = createInMemoryRuntime({ deliveries });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-draft",
      eventName: "pull_request",
    });

    expect(result).toBeNull();
  });

  it("removes labels when PR is closed", async () => {
    let labelsRemoved = false;
    const deliveries = new Map<string, any>([
      [
        "d-closed",
        {
          delivery_id: "d-closed",
          event_name: "pull_request",
          payload: {
            ...MOCK_RAW_PULL_REQUEST_PAYLOAD,
            action: "closed",
          },
        },
      ],
    ]);

    const { runtime } = createInMemoryRuntime({
      deliveries,
      githubClients: {
        forInstallation: () => ({
          getPullRequest: async () => {
            throw new Error("should not be called");
          },
          removeIssueLabelsIfPresent: async (owner: string, repo: string, prNumber: number, labels: string[]) => {
            labelsRemoved = true;
            expect(owner).toBe("acme");
            expect(repo).toBe("widgets");
            expect(prNumber).toBe(42);
            expect(labels).toHaveLength(3);
          },
        }),
      },
    });

    const result = await resolveQueuedJob(runtime, {
      deliveryId: "d-closed",
      eventName: "pull_request",
    });

    expect(result).toBeNull();
    expect(labelsRemoved).toBe(true);
  });

  it("ignores malformed comment payloads with null or primitive issue without throwing", async () => {
    const deliveries = new Map<string, any>([
      ["d-null-issue", { delivery_id: "d-null-issue", event_name: "issue_comment", payload: { issue: null } }],
      ["d-prim", { delivery_id: "d-prim", event_name: "issue_comment", payload: "bad-payload" }],
    ]);

    const { runtime } = createInMemoryRuntime({ noDefaultJob: true, deliveries });
    runtime.webhooks.normalizePayload = undefined;

    await expect(
      resolveQueuedJob(runtime, { deliveryId: "d-null-issue", eventName: "issue_comment" }),
    ).resolves.toBeNull();
    await expect(
      resolveQueuedJob(runtime, { deliveryId: "d-prim", eventName: "issue_comment" }),
    ).resolves.toBeNull();
  });
});
