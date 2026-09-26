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
import { runWithDb } from "@codraoss/db/client";

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

app.get("/health", (c) => c.text("OK"));

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

if (process.env.START_API !== "false") {
  const server = serve(
    {
      fetch: async (request) => {
        const apiEnv = {
          ...env,
          deps: createNodeApiDeps(env),
        };

        try {
          return await runWithDb(
            { ...env, HYPERDRIVE: env.DATABASE_CONFIG },
            () => app.fetch(request, apiEnv as any),
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

const shutdown = async () => {
  logger.info("Shutting down Codra Node server...");

  // Close BullMQ worker
  if (worker) {
    logger.info("Waiting for active BullMQ jobs to finish...");
    await worker.close();
    logger.info("BullMQ Worker closed gracefully.");
  }

  // Close Redis connection
  if (redisClient) {
    logger.info("Closing Redis client...");
    await redisClient.quit();
    logger.info("Redis client closed.");
  }

  // Postgres client manages its own pool.

  logger.info("All services stopped. Exiting.");
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
