import * as dotenv from 'dotenv';
import * as path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '../../.dev.vars') }); // Fallback if running from apps/node
dotenv.config({ path: path.resolve(process.cwd(), '.dev.vars') }); // Root level

import { serve } from '@hono/node-server';
import { createApiRouter } from '@codraoss/api';
import { runWithDb } from '@codraoss/db/client';

import { NodeOrchestrator, RedisKVAdapter, RedisQueueAdapter, RedisSessionStore, startWorker } from '@codraoss/node-adapters';
import { createNodeApiDeps } from './api-deps';
import { createNodeEnv, NodeAppBindings } from './env';
import { logger } from '@codraoss/api/logger';
import Redis from 'ioredis';
import { Queue } from 'bullmq';

import { serveStatic } from '@hono/node-server/serve-static';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createReviewRuntime } from './runtime';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined, // For managed Redis
});
redisClient.on('error', (err) => {
  logger.error('[Redis Error]', err);
});

const reviewQueue = new Queue('codra-reviews', { connection: redisClient });

const stubs = {
  SESSION_STORE: new RedisSessionStore(redisClient),
  KV_STORE: new RedisKVAdapter(redisClient),
  REVIEW_QUEUE: new RedisQueueAdapter(reviewQueue),
  REVIEW_ORCHESTRATOR: undefined, // Will be set to NodeOrchestrator below
};

const env: NodeAppBindings = createNodeEnv(stubs);
env.REVIEW_ORCHESTRATOR = new NodeOrchestrator(createReviewRuntime(env), stubs.REVIEW_QUEUE);

const app = createApiRouter();

app.onError((err, c) => {
  console.error('HONO ERROR:', err);
  return c.text('Custom Error: ' + err.message, 500);
});

// Static file serving
const distClientPath = path.resolve(__dirname, process.cwd().endsWith('node/dist') ? '../../dist/client' : '../dist/client');
app.use('/assets/*', serveStatic({ root: distClientPath }));
app.use('/*.svg', serveStatic({ root: distClientPath }));
app.use('/*.ico', serveStatic({ root: distClientPath }));
app.get('*', serveStatic({ root: distClientPath, path: 'index.html' }));

app.get('/health', (c) => c.text('OK')); // Healthcheck endpoint

const port = parseInt(process.env.PORT || '3000', 10);

let worker: ReturnType<typeof startWorker> | undefined;
if (process.env.START_WORKER !== 'false') {
  worker = startWorker(redisClient, stubs.REVIEW_QUEUE, () => createReviewRuntime(env), logger);
  logger.info('BullMQ Background Worker started.');
}

if (process.env.START_API !== 'false') {
  const server = serve({
    fetch: async (request) => {
      const apiEnv = {
        ...env,
        deps: createNodeApiDeps(env),
      };
      // Ensure runWithDb receives correct DbEnv type
      try { return await runWithDb({ ...env, HYPERDRIVE: env.DATABASE_CONFIG }, () => app.fetch(request, apiEnv as any)); } catch (e) { console.error('SERVE ERROR:', e); throw e; }
    },
    port,
    hostname: '0.0.0.0',
  }, (info) => {
    logger.info(`Codra Node server running on http://localhost:${info.port}`);
  });

  // Add server to shutdown sequence
  if (server) {
    const originalClose = server.close;
    server.close = () => new Promise<void>(resolve => {
      originalClose(() => {
        logger.info('HTTP server closed.');
        resolve();
      });
    });
  }
}

const shutdown = async () => {
  logger.info('Shutting down Codra Node server...');

  // Close BullMQ worker first to prevent new jobs
  if (worker) {
    logger.info('Waiting for active BullMQ jobs to finish...');
    await worker.close();
    logger.info('BullMQ Worker closed gracefully.');
  }

  // Close Redis connection
  if (redisClient) {
    logger.info('Closing Redis client...');
    await redisClient.quit();
    logger.info('Redis client closed.');
  }

  // Close Postgres connection pool
  // The postgres.js client automatically manages its pool.
  // runWithDb client is scoped, but a top-level client for specific operations might exist in the future
  // For now, no explicit close needed for `postgres.js` unless it's a global client.
  // If `runWithDb` is the only entry point, it manages its own connections.
  
  logger.info('All services stopped. Exiting.');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

