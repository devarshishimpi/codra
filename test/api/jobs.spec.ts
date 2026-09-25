import { createApiRouter } from "@codraoss/api";
import { getJobForProcessing, insertJob } from "@codraoss/db/jobs";

import { createTestEnv, uniqueName } from "../helpers";
import { vi } from "vitest";

describe("Dashboard API: jobs, stats and queue messages", () => {
  const app = createApiRouter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function getAuthCookie(
    env = createTestEnv(),
    login = "devarshishimpi",
    githubUserId = 42,
  ) {
    if (env.IDENTITY_PROVIDER && "defaultUser" in env.IDENTITY_PROVIDER) {
      (env.IDENTITY_PROVIDER as any).defaultUser = {
        provider: "github",
        providerUserId: githubUserId.toString(),
        login,
        name: "Devarshi Shimpi",
        avatarUrl: `https://avatars.githubusercontent.com/u/${githubUserId}`,
        email: null,
        signedInAt: new Date().toISOString(),
        metadata: {
          githubUserId,
          githubUsername: login,
        },
      };
    }

    const authStart = await app.request("/auth/github", {}, env);
    const authLocation = authStart.headers.get("location");
    expect(authStart.status).toBe(302);
    expect(authLocation).toBeTruthy();

    const state = authLocation
      ? new URL(authLocation).searchParams.get("state")
      : null;
    expect(state).toBeTruthy();

    const callback = await app.request(
      `/auth/github/callback?code=test-code&state=${state}`,
      {},
      env,
    );
    const cookieHeader = callback.headers.get("set-cookie") || "";
    const match = cookieHeader.match(/codra_session=([^;]+)/);

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/dashboard");

    return match ? match[1] : "";
  }

  it("answers 304 to a matching If-None-Match, including the weak validator the edge rewrites it to", async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);
    const job = await insertJob(env, {
      installationId: "123",
      owner: "api-test-owner",
      repo: uniqueName("etag"),
      prNumber: 1,
      prTitle: "Etag",
      prAuthor: "author",
      commitSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });
    const headers = {
      Cookie: `codra_session=${token}`,
      "x-requested-with": "XMLHttpRequest",
    };

    const first = await app.request(`/api/jobs/${job.id}`, { headers }, env);
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const strong = await app.request(
      `/api/jobs/${job.id}`,
      { headers: { ...headers, "if-none-match": etag! } },
      env,
    );
    expect(strong.status).toBe(304);

    // Cloudflare compresses responses at the edge and rewrites strong ETags to weak ones,
    // so browsers echo back W/"..."; that must still short-circuit to 304.
    const weak = await app.request(
      `/api/jobs/${job.id}`,
      { headers: { ...headers, "if-none-match": `W/${etag}` } },
      env,
    );
    expect(weak.status).toBe(304);

    const stale = await app.request(
      `/api/jobs/${job.id}`,
      { headers: { ...headers, "if-none-match": '"job-other"' } },
      env,
    );
    expect(stale.status).toBe(200);
  });

  it("reruns a job from start: creates a fresh job that does NOT inherit the parent (no retryOfJobId)", async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);
    const source = await insertJob(env, {
      installationId: "123",
      owner: "api-test-owner",
      repo: uniqueName("rerun"),
      prNumber: 1,
      prTitle: "Rerun",
      prAuthor: "author",
      commitSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      trigger: "auto",
      headRef: "feature",
      baseRef: "main",
    });

    const response = await app.request(
      `/api/jobs/${source.id}/rerun`,
      {
        method: "POST",
        headers: {
          Cookie: `codra_session=${token}`,
          "x-requested-with": "XMLHttpRequest",
        },
      },
      env,
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as { job: { id: string } };
    expect(body.job.id).not.toBe(source.id);
    const fresh = await getJobForProcessing(env, body.job.id);
    // Rerun-from-start must not inherit parent file reviews, so retry_of_job_id stays null.
    expect(fresh?.retry_of_job_id ?? null).toBeNull();
  });
});
