import { createApiRouter } from "@codraoss/api";
import { createApiRouterDeps } from "../../apps/worker/src/api-deps";
import { createTestEnv } from "../helpers";

// `IDENTITY_PROVIDER` is a test seam: only `createTestEnv` ever sets it. The Aug-16 auth refactor read
// it unconditionally, so in production -- where the binding does not exist -- `/auth/github`
// dereferenced undefined and sign-in 500'd for everyone. Every auth test passed, because every auth
// test had the fake injected.
//
// This file is the one place that runs the wiring the way production does: with no injected provider.
describe("identity provider default", () => {
  const app = createApiRouter();

  function productionLikeEnv() {
    const env = createTestEnv();
    delete (env as any).IDENTITY_PROVIDER;
    // Deps captured the env at creation; rebuild them so the wiring resolves against the binding-less env.
    (env as any).deps = createApiRouterDeps(env as any, {} as any);
    return env;
  }

  it("starts GitHub sign-in against the real OAuth endpoint when no fake is injected", async () => {
    const response = await app.request("/auth/github", {}, productionLikeEnv());

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("redirect_uri")).toBeTruthy();
  });

  it("still prefers an injected provider when one exists", async () => {
    // The seam itself must keep working, or the rest of the auth suite is quietly testing production.
    const env = createTestEnv();
    const response = await app.request("/auth/github", {}, env);

    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").not.toContain("github.com");
  });
});
