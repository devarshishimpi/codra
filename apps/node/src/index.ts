import * as dotenv from "dotenv";
import * as path from "node:path";
import { readFile } from "node:fs/promises";
dotenv.config({ path: path.resolve(process.cwd(), "../../.dev.vars") });
dotenv.config({ path: path.resolve(process.cwd(), ".dev.vars") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env.local") });

import { serve } from "@hono/node-server";
import { createApiRouter } from "@codraoss/api";
import { runWithDb, getDb, type DbClient } from "@codraoss/db/client";
import type { DbEnv } from "@codraoss/db/env";

import {
  NodeOrchestrator,
  RedisKVAdapter,
  RedisQueueAdapter,
  RedisSessionStore,
  startWorker,
} from "@codraoss/node-adapters";
import { createNodeApiDeps } from "./api-deps";
import { createNodeEnv, type NodeAppBindings } from "./env";
import { logger } from "@codraoss/api/logger";
import Redis from "ioredis";
import { Queue } from "bullmq";

import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { createReviewRuntime } from "./runtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redisClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  family: 4,
  tls: redisUrl.startsWith("rediss://")
    ? { rejectUnauthorized: process.env.REDIS_INSECURE_TLS !== "true" }
    : undefined, // Managed Redis
});
redisClient.on("error", (err) => {
  logger.error("[Redis Error]", err);
});

const reviewQueue = new Queue("codra-reviews", { connection: redisClient });

const stubs = {
  SESSION_STORE: new RedisSessionStore(redisClient),
  APP_KV: new RedisKVAdapter(redisClient),
  REVIEW_QUEUE: new RedisQueueAdapter(reviewQueue),
  REVIEW_ORCHESTRATOR: undefined as NodeOrchestrator | undefined,
};

const env: NodeAppBindings = createNodeEnv(stubs);
env.REVIEW_ORCHESTRATOR = new NodeOrchestrator(
  createReviewRuntime(env),
  stubs.REVIEW_QUEUE,
);

const dbEnv: DbEnv = {
  ...env,
  HYPERDRIVE: env.DATABASE_CONFIG,
  workerMode: false,
};
const dbClient: DbClient = getDb(dbEnv);

const distClientPath = path.resolve(__dirname, "../../../dist/client");
const app = createApiRouter({
  serveIndex: async () =>
    new Response(await readFile(path.join(distClientPath, "index.html")), {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    }),
});

app.onError((err, c) => {
  console.error("HONO ERROR:", err);
  return c.text("Custom Error: " + err.message, 500);
});

app.use("/assets/*", serveStatic({ root: distClientPath }));
app.use("/icons/*", serveStatic({ root: distClientPath }));
app.use("/*.svg", serveStatic({ root: distClientPath }));
app.use("/*.ico", serveStatic({ root: distClientPath }));
app.get("*", serveStatic({ root: distClientPath, path: "index.html" }));

const port = parseInt(process.env.PORT || "3000", 10);

let worker: ReturnType<typeof startWorker> | undefined;
if (process.env.START_WORKER !== "false") {
  worker = startWorker(
    redisClient,
    stubs.REVIEW_QUEUE,
    () => createReviewRuntime(env),
    logger,
  );
  logger.info("BullMQ Background Worker started.");
}

let server: ReturnType<typeof serve> | undefined;
if (process.env.START_API !== "false") {
  server = serve(
    {
      fetch: async (request) => {
        const apiEnv = {
          ...env,
          deps: createNodeApiDeps(env),
        };

        try {
          return await runWithDb(
            dbEnv,
            () => app.fetch(request, apiEnv as any),
            dbClient,
          );
        } catch (e) {
          console.error("SERVE ERROR:", e);
          return new Response("Internal Server Error", { status: 500 });
        }
      },
      port,
      hostname: "0.0.0.0",
    },
    (info) => {
      logger.info(`Codra Node server running on http://localhost:${info.port}`);
    },
  );

  if (server) {
    const originalClose = server.close.bind(server);
    server.close = function (callback?: (err?: Error) => void) {
      return originalClose((err?: Error) => {
        logger.info("HTTP server closed.");
        if (callback) callback(err);
      });
    } as typeof server.close;
  }
}

// Model registry refresh in background (zero DB impact, unreferenced interval)
import("@codraoss/models").then(({ ModelRegistryService }) => {
  const service = ModelRegistryService.getInstance();
  service.refreshFromRemote().catch(() => {});
  const timer = setInterval(() => service.refreshFromRemote().catch(() => {}), 60 * 60 * 1000);
  (timer as unknown as { unref?: () => void }).unref?.();
}).catch(() => {});

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

let isShuttingDown = false;
let shutdownStartTime = 0;
const shutdown = async (signal?: string) => {
  const now = Date.now();
  if (isShuttingDown) {
    if (now - shutdownStartTime > 100) {
      logger.warn("Repeated shutdown signal received, forcing immediate exit.");
      process.exit(signal === "SIGINT" ? 130 : 143);
    }
    return;
  }
  isShuttingDown = true;
  shutdownStartTime = now;

  const globalShutdownTimeout = setTimeout(() => {
    logger.error("Global shutdown timed out after 10000ms. Forcing immediate exit.");
    process.exit(1);
  }, 10000);
  globalShutdownTimeout.unref?.();

  logger.info("Shutting down Codra Node server...");

  let exitCode = 0;

  // 1. Close HTTP server listener
  if (server) {
    try {
      logger.info("Closing HTTP server listener...");
      await new Promise<void>((resolve, reject) => {
        let isDone = false;
        const finish = (err?: unknown) => {
          if (isDone) return;
          isDone = true;
          clearTimeout(drainTimer);
          clearTimeout(hardTimer);
          if (err) reject(err);
          else resolve();
        };

        const drainTimer = setTimeout(() => {
          (server as unknown as { closeAllConnections?: () => void })?.closeAllConnections?.();
        }, 3000);
        drainTimer.unref?.();

        const hardTimer = setTimeout(() => {
          finish(new Error("HTTP server listener close timed out after 5000ms"));
        }, 5000);
        hardTimer.unref?.();

        server?.close((err) => {
          if (err) finish(err);
          else finish();
        });
      });
      logger.info("HTTP server listener closed.");
    } catch (err) {
      logger.error("Error closing HTTP server listener:", err);
      exitCode = 1;
    }
  }

  // 2. Close BullMQ worker
  if (worker) {
    try {
      logger.info("Waiting for active BullMQ jobs to finish...");
      await withTimeout(worker.close(), 4000, "BullMQ worker close");
      logger.info("BullMQ Worker closed gracefully.");
    } catch (err) {
      logger.error("Error closing BullMQ worker:", err);
      exitCode = 1;
    }
  }

  // 3. Close BullMQ queue
  if (reviewQueue) {
    try {
      await withTimeout(reviewQueue.close(), 2000, "BullMQ reviewQueue close");
    } catch (err) {
      logger.error("Error closing reviewQueue:", err);
      exitCode = 1;
    }
  }

  // 4. Close Redis connection
  if (redisClient) {
    try {
      logger.info("Closing Redis client...");
      await withTimeout(redisClient.quit(), 2000, "Redis client quit");
      logger.info("Redis client closed.");
    } catch (err) {
      logger.error("Error closing Redis client:", err);
      try {
        redisClient.disconnect();
      } catch {
        // Disconnect fallback
      }
      exitCode = 1;
    }
  }

  // 5. Close Postgres client pool
  if (dbClient?.close) {
    try {
      logger.info("Closing Postgres client...");
      await withTimeout(dbClient.close(), 2000, "Postgres client close");
      logger.info("Postgres client closed.");
    } catch (err) {
      logger.error("Error closing Postgres client:", err);
      exitCode = 1;
    }
  }

  clearTimeout(globalShutdownTimeout);

  if (exitCode === 0) {
    logger.info("All services stopped. Exiting.");
  } else {
    logger.error("Services stopped with errors. Exiting.");
  }
  process.exit(exitCode);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
