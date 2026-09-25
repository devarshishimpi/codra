import { createApiRouter } from "@codraoss/api";
import type { AuthorizeContext, AuthzPort } from "@codraoss/api";
import { getJobForProcessing, insertJob } from "@codraoss/db/jobs";
import type { AppBindings } from "@server/env";

import { createTestEnv, dbDescribe, uniqueName } from "../helpers";

dbDescribe("Dashboard API: authorization port", () => {
  const app = createApiRouter();

  async function signIn(
    env: AppBindings,
    login = "devarshishimpi",
    githubUserId = 42,
  ) {
    // The fake identity must report a login present in DASHBOARD_ALLOWED_USERS or the callback rejects it.
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
      owner: "authz-owner",
      repo: uniqueName(label),
      prNumber: 1,
      prTitle: "Authz",
      prAuthor: "author",
      commitSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });
  }

  it("allows every action when no authorization port is configured", async () => {
    const env = createTestEnv();
    const token = await signIn(env);
    const job = await newJob(env, "authz-allow");

    const response = await app.request(
      `/api/jobs/${job.id}`,
      { headers: authHeaders(token) },
      env,
    );

    expect(response.status).toBe(200);
  });

  it("refuses a denied action with a 403 and leaves the resource untouched", async () => {
    const authz: AuthzPort = {
      async authorize({ action }) {
        return action === "jobs.delete"
          ? { allowed: false, reason: "read-only member" }
          : { allowed: true };
      },
    };
    const env = createTestEnv({}, { authz });
    const token = await signIn(env);
    const job = await newJob(env, "authz-deny");

    const response = await app.request(
      `/api/jobs/${job.id}`,
      {
        method: "DELETE",
        headers: authHeaders(token),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Forbidden",
      code: "forbidden",
      action: "jobs.delete",
      reason: "read-only member",
    });

    // The guard has to run before the handler does any work, not merely change the response.
    expect(await getJobForProcessing(env, job.id)).not.toBeNull();
  });

  it("passes the action and resource identity of the request to the port", async () => {
    const seen: AuthorizeContext[] = [];
    const authz: AuthzPort = {
      async authorize(ctx) {
        seen.push(ctx);
        return { allowed: true };
      },
    };
    const env = createTestEnv({}, { authz });
    const token = await signIn(env);
    const job = await newJob(env, "authz-ctx");

    await app.request("/api/settings", { headers: authHeaders(token) }, env);
    await app.request(
      `/api/jobs/${job.id}`,
      { headers: authHeaders(token) },
      env,
    );
    await app.request(
      "/api/repos/some-owner/some-repo/config",
      {
        method: "PATCH",
        headers: { ...authHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({}),
      },
      env,
    );

    expect(seen.map((c) => c.action)).toEqual([
      "settings.read",
      "jobs.read",
      "repos.config.write",
    ]);
    expect(seen[1].resource).toEqual({ type: "job", id: job.id });
    expect(seen[2].resource).toEqual({
      type: "repo",
      id: "some-owner/some-repo",
    });
    expect(seen[0].user.login).toBeTruthy();
  });

  it("reports computed permissions on the session endpoint, and omits the field without a port", async () => {
    const withPort = createTestEnv(
      {},
      {
        authz: {
          async authorize() {
            return { allowed: true };
          },
          async listPermissions() {
            return ["jobs.read", "stats.read"];
          },
        },
      },
    );
    const token = await signIn(withPort);

    const scoped = await app.request(
      "/api/auth/session",
      { headers: authHeaders(token) },
      withPort,
    );
    expect(scoped.status).toBe(200);
    expect(
      ((await scoped.json()) as { permissions?: string[] }).permissions,
    ).toEqual(["jobs.read", "stats.read"]);

    const plain = createTestEnv();
    const plainToken = await signIn(plain);
    const unscoped = await app.request(
      "/api/auth/session",
      { headers: authHeaders(plainToken) },
      plain,
    );
    expect(unscoped.status).toBe(200);
    expect(await unscoped.json()).not.toHaveProperty("permissions");
  });
});
