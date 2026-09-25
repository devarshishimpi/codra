import { createApiRouter } from "@codraoss/api";
import { createTestEnv } from "../helpers";

// Two production outages came out of `serveIndex`, each hidden behind the other, and both invisible to
// a suite that never requested an HTML page:
//
//   1. `fetch` pulled off the ASSETS binding into a local -- the runtime rejects a detached binding
//      method with "Illegal invocation", so every HTML route 500'd while the API kept answering.
//   2. Once that was fixed, the handler asked the binding for `/index.html`, which Workers assets
//      canonicalize into a 307 back to `/` (html_handling: auto-trailing-slash). With `/` in
//      run_worker_first the redirect re-enters the same handler: ERR_TOO_MANY_REDIRECTS for everyone.
//
// MockAssets now reproduces both runtime behaviours, so this file covers the least glamorous thing
// there is: that the app serves its own index, as content, in one round trip.
describe("static routes", () => {
  const app = createApiRouter();

  it("serves the index as a 200, never a redirect", async () => {
    const env = createTestEnv();

    const response = await app.request("/", {}, env);

    // The loop bug shipped as a well-formed 307; only asserting on the FINAL status catches it.
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toContain("text/html");
  });

  it("calls the assets binding as a method, not as a detached function", async () => {
    // A detached call is what 500'd production. Assert the binding's own `this` reached it, which the
    // mock enforces by throwing exactly as the runtime does.
    const env = createTestEnv();
    let sawThis = false;
    const real = (env as any).ASSETS;
    (env as any).ASSETS = {
      fetch(this: unknown, input: RequestInfo | URL) {
        sawThis = this === (env as any).ASSETS;
        return real.fetch.call(real, input);
      },
    };

    const response = await app.request("/", {}, env);

    expect(response.status).toBe(200);
    expect(sawThis).toBe(true);
  });

  it("asks the binding for the canonical path, not /index.html", async () => {
    // Requesting /index.html is what looped production: assets 307 it back to /, and / re-enters this
    // handler. The canonical `/` serves the same content as a 200.
    const env = createTestEnv();
    const asked: string[] = [];
    const real = (env as any).ASSETS;
    (env as any).ASSETS = {
      fetch(input: RequestInfo | URL) {
        asked.push(
          new URL(input instanceof Request ? input.url : String(input))
            .pathname,
        );
        return real.fetch.call(real, input);
      },
    };

    // `/login` is the other unauthenticated HTML route; the authenticated ones redirect without a
    // session, so this pair is what can be checked without standing up auth.
    await app.request("/", {}, env);
    await app.request("/login", {}, env);

    expect(asked).toEqual(["/", "/"]);
  });

  it("says so plainly when no assets binding is mounted", async () => {
    const env = createTestEnv();
    delete (env as any).ASSETS;

    const response = await app.request("/", {}, env);

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("static assets");
  });
});
