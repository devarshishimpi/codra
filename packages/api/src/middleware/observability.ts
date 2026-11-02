import type { MiddlewareHandler } from "hono";
import type { ApiEnv } from "../ports";
import { logger } from "../logger";

export const observability: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();
  c.set("requestId", requestId);

  return logger.runWithContext(
    {
      requestId,
      method: c.req.method,
      path: c.req.path,
    },
    async () => {
      logger.info(`Incoming request: ${c.req.method} ${c.req.path}`);

      const start = Date.now();
      await next();
      const duration = Date.now() - start;

      logger.info(`Request completed: ${c.req.method} ${c.req.path}`, {
        status: c.res.status,
        durationMs: duration,
      });
    },
  );
};
