import { describe, it, expect } from "vitest";
import {
  createDefaultQuotaChecker,
  createSharedApiDeps,
  createApiRouter,
} from "@codraoss/api";
import { findBotReviewForCommit } from "@codraoss/provider-github";
import type { KvCompat } from "@codraoss/api/platform";

class MockMemoryKV implements KvCompat {
  private store = new Map<string, string>();

  async put(
    key: string,
    value: string,
    _options?: { expirationTtl?: number },
  ): Promise<void> {
    this.store.set(key, value);
  }

  async get(key: string, type?: "json" | "text"): Promise<any> {
    const val = this.store.get(key);
    if (val === undefined) return null;
    if (type === "json") return JSON.parse(val);
    return val;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe("Default Quota Checker & Rate Limiting", () => {
  it("allows requests under the review limit and enforces quota when limit is reached", async () => {
    const kv = new MockMemoryKV();
    const checker = createDefaultQuotaChecker(kv, {
      maxReviewsPerWindow: 3,
      windowSeconds: 60,
    });

    const input = {
      action: "reviews.enqueue" as const,
      subject: { installationId: "inst-1", owner: "org-1", repo: "repo-1" },
    };

    // First 3 requests should be allowed
    expect((await checker(input)).allowed).toBe(true);
    expect((await checker(input)).allowed).toBe(true);
    expect((await checker(input)).allowed).toBe(true);

    // 4th request must be rejected
    const blocked = await checker(input);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.reason).toContain("Quota exceeded");
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("isolates counters by subject (different installations/repos have independent quotas)", async () => {
    const kv = new MockMemoryKV();
    const checker = createDefaultQuotaChecker(kv, {
      maxReviewsPerWindow: 2,
      windowSeconds: 60,
    });

    const repo1 = {
      action: "reviews.enqueue" as const,
      subject: { installationId: "inst-1", owner: "org-1", repo: "repo-1" },
    };
    const repo2 = {
      action: "reviews.enqueue" as const,
      subject: { installationId: "inst-2", owner: "org-2", repo: "repo-2" },
    };

    expect((await checker(repo1)).allowed).toBe(true);
    expect((await checker(repo1)).allowed).toBe(true);
    expect((await checker(repo1)).allowed).toBe(false);

    // repo2 should still be allowed
    expect((await checker(repo2)).allowed).toBe(true);
    expect((await checker(repo2)).allowed).toBe(true);
    expect((await checker(repo2)).allowed).toBe(false);
  });

  it("applies maxRetriesPerWindow for dashboard retry/rerun actions", async () => {
    const kv = new MockMemoryKV();
    const checker = createDefaultQuotaChecker(kv, {
      maxRetriesPerWindow: 2,
      windowSeconds: 60,
    });

    const retryInput = {
      action: "jobs.retry" as const,
      user: { login: "developer" } as any,
    };

    expect((await checker(retryInput)).allowed).toBe(true);
    expect((await checker(retryInput)).allowed).toBe(true);
    const blocked = await checker(retryInput);
    expect(blocked.allowed).toBe(false);
  });

  it("fails open if KV access throws", async () => {
    const failingKv: KvCompat = {
      async put() {
        throw new Error("KV offline");
      },
      async get() {
        throw new Error("KV offline");
      },
      async delete() {},
    };

    const checker = createDefaultQuotaChecker(failingKv);
    const res = await checker({
      action: "reviews.enqueue" as const,
      subject: { installationId: "123" },
    });
    expect(res.allowed).toBe(true);
  });
});

describe("Bot Review Exact Matching", () => {
  function makeMockCtx(reviews: Array<{ commit_id: string; user: { login: string } }>): any {
    return {
      async request() {
        return new Response(JSON.stringify(reviews), { status: 200 });
      },
      async requestAndCheck() {
        return new Response(JSON.stringify(reviews), { status: 200 });
      },
    };
  }

  it("matches exact bot username", async () => {
    const ctx = makeMockCtx([
      { commit_id: "sha1", user: { login: "codra" } },
    ]);
    const found = await findBotReviewForCommit(ctx, "owner", "repo", 1, "sha1", "codra");
    expect(found).not.toBeNull();
  });

  it("matches exact bot username with [bot] suffix", async () => {
    const ctx = makeMockCtx([
      { commit_id: "sha1", user: { login: "codra[bot]" } },
    ]);
    const found = await findBotReviewForCommit(ctx, "owner", "repo", 1, "sha1", "codra");
    expect(found).not.toBeNull();
  });

  it("rejects spoofed username that merely starts with the bot username", async () => {
    const ctx = makeMockCtx([
      { commit_id: "sha1", user: { login: "codra-attacker" } },
      { commit_id: "sha1", user: { login: "codrabot" } },
      { commit_id: "sha1", user: { login: "codra123" } },
    ]);
    const found = await findBotReviewForCommit(ctx, "owner", "repo", 1, "sha1", "codra");
    expect(found).toBeNull();
  });
});
