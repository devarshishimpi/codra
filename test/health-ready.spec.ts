import { describe, expect, it, vi } from "vitest";
import { createApiRouter } from "@codraoss/api";

const ok = async () => {};

function request(health?: { database: () => Promise<void>; kv: () => Promise<void> }) {
  const app = createApiRouter();
  return app.request("/health/ready", {}, { deps: { health } } as any);
}

describe("GET /health/ready", () => {
  it("returns 200 when the database and the KV store answer", async () => {
    const res = await request({ database: ok, kv: ok });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ok",
      checks: { database: { status: "ok" }, kv: { status: "ok" } },
    });
  });

  it("returns 503 and names the failed dependency when one is down", async () => {
    const res = await request({
      database: async () => {
        throw new Error("connect ECONNREFUSED postgres://user:secret@db.internal:5432/codra");
      },
      kv: ok,
    });
    expect(res.status).toBe(503);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.status).toBe("unhealthy");
    expect(body.checks.database).toEqual({ status: "failed", error: "unreachable" });
    expect(body.checks.kv).toEqual({ status: "ok" });
    expect(text).not.toContain("secret");
    expect(text).not.toContain("db.internal");
  });

  it("returns 503 with both checks failed when everything is down", async () => {
    const down = async () => {
      throw new Error("down");
    };
    const res = await request({ database: down, kv: down });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks.database.status).toBe("failed");
    expect(body.checks.kv.status).toBe("failed");
  });

  it("reports a probe that hangs as a timeout", async () => {
    vi.useFakeTimers();
    try {
      const pending = request({ database: () => new Promise<void>(() => {}), kv: ok });
      await vi.advanceTimersByTimeAsync(2100);
      const res = await pending;
      expect(res.status).toBe(503);
      expect((await res.json()).checks.database).toEqual({ status: "failed", error: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 503 when no probes are wired", async () => {
    expect((await request(undefined)).status).toBe(503);
  });
});

describe("GET /health (liveness)", () => {
  it("stays 200 without touching any dependency", async () => {
    const database = vi.fn(ok);
    const kv = vi.fn(ok);
    const app = createApiRouter();
    const res = await app.request("/health", {}, { deps: { health: { database, kv } } } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
    expect(database).not.toHaveBeenCalled();
    expect(kv).not.toHaveBeenCalled();
  });
});
