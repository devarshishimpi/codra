import { createApiRouter } from "@codraoss/api";
import type { QuotaCheckInput, QuotaResult } from "@codraoss/api";
import { insertJob } from "@codraoss/db/jobs";
import type { AppBindings } from "@server/env";

import {
  createMockPRWebhook,
  createTestEnv,
  dbDescribe,
  uniqueName,
} from "../helpers";
import { signPayload } from "../mocks/fixtures";

dbDescribe("Dashboard API: quota port", () => {
  const app = createApiRouter();

  async function signIn(
    env: AppBindings,
    login = "devarshishimpi",
    githubUserId = 42,
  ) {
    if (env.IDENTITY_PROVIDER && "defaultUser" in env.IDENTITY_PROVIDER) {
      (env.IDENTITY_PROVIDER as any).defaultUser = {
        provider: "github",
        providerUserId: String(githubUserId),
        login,
        name: "Devarshi Shimpi",
        avatarUrl: null,
        email: null,
        signedInAt: new Date().toISOString(),
        metadata: { githubUserId, githubUsername: login },
      };
    }
    const authStart = await app.request("/auth/github", {}, env);
    const location = authStart.headers.get("location");
    const state = location ? new URL(location).searchParams.get("state") : null;
    const callback = await app.request(
      `/auth/github/callback?code=test-code&state=${state}`,
      {},
      env,
    );
    const match = (callback.headers.get("set-cookie") || "").match(
      /codra_session=([^;]+)/,
    );
    return match ? match[1] : "";
  }

  function authHeaders(token: string) {
    return {
      Cookie: `codra_session=${token}`,
      "x-requested-with": "XMLHttpRequest",
    };
  }

  async function newJob(env: AppBindings, label: string) {
    return insertJob(env, {
      installationId: "123",
      owner: "quota-owner",
      repo: uniqueName(label),
      prNumber: 1,
      prTitle: "Quota",
      prAuthor: "author",
      commitSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });
  }

  it("answers 429 with Retry-After when the quota port refuses a dashboard action", async () => {
    const env = createTestEnv(
      {},
      {
        async checkQuota(): Promise<QuotaResult> {
          return {
            allowed: false,
            retryAfterSeconds: 90,
            reason: "monthly review limit reached",
          };
        },
      },
    );
    const token = await signIn(env);
    const job = await newJob(env, "quota-deny");

    const response = await app.request(
      `/api/jobs/${job.id}/rerun`,
      {
        method: "POST",
        headers: authHeaders(token),
      },
      env,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    expect(await response.json()).toEqual({
      error: "Too many requests",
      code: "quota_exceeded",
      action: "jobs.rerun",
      reason: "monthly review limit reached",
    });
  });

  it("passes the signed-in user to the quota port and proceeds when allowed", async () => {
    const seen: QuotaCheckInput[] = [];
    const env = createTestEnv(
      {},
      {
        async checkQuota(input): Promise<QuotaResult> {
          seen.push(input);
          return { allowed: true };
        },
      },
    );
    const token = await signIn(env);
    const job = await newJob(env, "quota-allow");

    const response = await app.request(
      `/api/jobs/${job.id}/rerun`,
      {
        method: "POST",
        headers: authHeaders(token),
      },
      env,
    );

    expect(response.status).toBe(202);
    expect(seen).toHaveLength(1);
    expect(seen[0].action).toBe("jobs.rerun");
    expect(seen[0].user?.login).toBe("devarshishimpi");
  });

  it("drops a quota-denied webhook as 202-ignored without enqueueing a review", async () => {
    const env = createTestEnv(
      {},
      {
        async checkQuota(): Promise<QuotaResult> {
          return { allowed: false, reason: "plan limit" };
        },
      },
    );

    const body = JSON.stringify(
      createMockPRWebhook({
        repository: {
          name: uniqueName("quota-webhook"),
          owner: { login: "quota-owner" },
        },
      }),
    );
    const signature = await signPayload(env.GITHUB_APP_WEBHOOK_SECRET, body);

    const response = await app.request(
      "http://codra.test/webhook",
      {
        method: "POST",
        headers: {
          "x-github-event": "pull_request",
          "x-github-delivery": `quota-${Date.now()}`,
          "x-hub-signature-256": signature,
        },
        body,
      },
      env,
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      ok: true,
      ignored: true,
      reason: "quota_exceeded",
    });
    expect((env.REVIEW_QUEUE as any).sent).toHaveLength(0);
  });

  it("leaves every path untouched when no quota port is configured", async () => {
    const env = createTestEnv();
    const token = await signIn(env);
    const job = await newJob(env, "quota-absent");

    const response = await app.request(
      `/api/jobs/${job.id}/rerun`,
      {
        method: "POST",
        headers: authHeaders(token),
      },
      env,
    );

    expect(response.status).toBe(202);
  });
});
