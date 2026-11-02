import { Hono } from "hono";
import type { ApiEnv } from "../../ports";
import { requirePermission } from "../../middleware/authorize";

export function createStatsRouter() {
  const app = new Hono<ApiEnv>();

  app.get("/", async (c) => {
    const denied = await requirePermission(c, "stats.read");
    if (denied) return denied;
    const daysParam = c.req.query("days");
    const days = daysParam ? parseInt(daysParam, 10) : 30;
    // Grouped in the caller's display zone so the trend matches timestamps shown elsewhere; getStats falls back to UTC if invalid.
    const timeZone = c.req.query("tz") ?? "UTC";
    const stats = await c.env.deps.repositories.stats.getStats(
      c.env as any,
      days,
      timeZone,
    );
    return c.json({ stats });
  });

  return app;
}
