import { GitHubClient } from "@codraoss/provider-github";
import { createTestEnv } from "../helpers";
import { vi } from "vitest";

// A clean review now gets a thumbs-up on the pull request's opening post, so the author sees the
// outcome without opening the review. `/issues/{n}/reactions` is the endpoint that reaches that post --
// `/pulls/{n}` has no reactions collection at all.
describe("addIssueReaction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function client() {
    const env = createTestEnv();
    await env.APP_KV.put(
      "install:123",
      JSON.stringify({
        token: "cached-installation-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    return new GitHubClient(env, "123");
  }

  it("posts a +1 to the pull request issue thread", async () => {
    let seen: { url: string; method?: string; body?: unknown } | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      seen = { url: String(input), method: init?.method, body: init?.body };
      return new Response(null, { status: 201 });
    });

    await (await client()).addIssueReaction("owner", "repo", 90, "+1");

    expect(seen!.url).toBe(
      "https://api.github.com/repos/owner/repo/issues/90/reactions",
    );
    expect(seen!.method).toBe("POST");
    expect(JSON.parse(String(seen!.body))).toEqual({ content: "+1" });
  });

  // GitHub answers 200 with the existing reaction when the same user reacts again, which is what makes
  // a retried finalize safe rather than duplicating.
  it("treats an already-present reaction as success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 }),
    );

    await expect(
      (await client()).addIssueReaction("owner", "repo", 90, "+1"),
    ).resolves.toBeUndefined();
  });

  it("surfaces a real failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
    );

    await expect(
      (await client()).addIssueReaction("owner", "repo", 90, "+1"),
    ).rejects.toThrow();
  });
});
