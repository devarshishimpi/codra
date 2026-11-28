import { Hono } from "hono";
import type { ApiEnv } from "../ports";
import { logger } from "../logger";

const PROBE_TIMEOUT_MS = 2000;

type CheckResult = { status: "ok" } | { status: "failed"; error: string };

async function probe(name: string, run: () => Promise<void>): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS);
      }),
    ]);
    return { status: "ok" };
  } catch (error) {
    // The raw message can carry a host name or connection string, so neither the body nor the log gets it.
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown } | null)?.code;
    logger.warn(`Readiness probe failed: ${name}`, {
      error: error instanceof Error ? error.name : "unknown",
      ...(typeof code === "string" ? { code } : {}),
    });
    return { status: "failed", error: message === "timeout" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthRouter() {
  const app = new Hono<ApiEnv>();

  app.get("/ready", async (c) => {
    const probes = c.env.deps?.health;
    const [database, kv] = probes
      ? await Promise.all([probe("database", probes.database), probe("kv", probes.kv)])
      : [{ status: "failed", error: "unreachable" } as CheckResult, { status: "failed", error: "unreachable" } as CheckResult];
    const healthy = database.status === "ok" && kv.status === "ok";
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        status: healthy ? "ok" : "unhealthy",
        timestamp: new Date().toISOString(),
        checks: { database, kv },
      },
      healthy ? 200 : 503,
    );
  });

  return app;
}
