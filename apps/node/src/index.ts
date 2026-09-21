import * as dotenv from 'dotenv';
import * as path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '../../.dev.vars') }); // Fallback if running from apps/node
dotenv.config({ path: path.resolve(process.cwd(), '.dev.vars') }); // Root level
import { serve } from '@hono/node-server';
import { createApiRouter } from '@codraoss/api';
import { runWithDb } from '@codraoss/db/client';
import { createNodeApiDeps } from './api-deps';
import { createNodeEnv } from './env';
import { logger } from '@codraoss/api/logger';
import Redis from 'ioredis';
import { RedisKVAdapter } from './adapters/redis-kv';
import { Queue } from 'bullmq';
import { RedisQueueAdapter } from './adapters/redis-queue';
import { NodeOrchestrator } from './adapters/node-orchestrator';
import { startWorker } from './worker';
import { createReviewRuntime } from './runtime';
import { RedisSessionStore } from './adapters/redis-session-store';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = new Redis(redisUrl, { maxRetriesPerRequest: null }); // maxRetriesPerRequest: null is required for bullmq
redisClient.on('error', (err) => {
  logger.error('[Redis Error]', err);
});

const reviewQueue = new Queue('codra-reviews', { connection: redisClient });

const stubs = {
  SESSION_STORE: new RedisSessionStore(redisClient),
  APP_KV: new RedisKVAdapter(redisClient),
  REVIEW_QUEUE: new RedisQueueAdapter(reviewQueue),
  REVIEW_ORCHESTRATOR: undefined, // Will be set to NodeOrchestrator below
};

const env = createNodeEnv(stubs);
env.REVIEW_ORCHESTRATOR = new NodeOrchestrator(createReviewRuntime(env));

import fs from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';

const dashboardDist = path.resolve(process.cwd(), process.cwd().endsWith('node') ? '../../dist/client' : 'dist/client');

const envWithAssets = {
  ...env,
  ASSETS: {
    fetch: async (_req: Request) => {
      try {
        console.log('fetching index.html from', path.join(dashboardDist, 'index.html'));
        const html = fs.readFileSync(path.join(dashboardDist, 'index.html'), 'utf-8');
        console.log('html length:', html.length);
        return new Response(html, { headers: { 'content-type': 'text/html' } });
      } catch (e) {
        console.error('ASSETS error:', e);
        return new Response('Dashboard build not found. Run npm run build -w @codraoss/dashboard', { status: 404 });
      }
    }
  }
};

const app = createApiRouter();
app.onError((err, c) => {
  console.error('HONO ERROR:', err);
  return c.text('Custom Error: ' + err.message, 500);
});
app.use('/assets/*', serveStatic({ root: process.cwd().endsWith('node') ? '../../dist/client' : 'dist/client' }));
app.use('/*.svg', serveStatic({ root: process.cwd().endsWith('node') ? '../../dist/client' : 'dist/client' }));
app.use('/*.ico', serveStatic({ root: process.cwd().endsWith('node') ? '../../dist/client' : 'dist/client' }));
const port = parseInt(process.env.PORT || '3000', 10);

let worker: ReturnType<typeof startWorker> | undefined;
if (process.env.START_WORKER !== 'false') {
  worker = startWorker(env, redisUrl);
  logger.info('BullMQ Background Worker started.');
}

const server = serve({
  fetch: async (request) => {
    const apiEnv = {
      ...envWithAssets,
      deps: createNodeApiDeps(env),
    };
    try { return await runWithDb(env, () => app.fetch(request, apiEnv as any)); } catch (e) { console.error('SERVE ERROR:', e); throw e; }
  },
  port,
}, (info) => {
  logger.info(`Codra Node server running on http://localhost:${info.port}`);
});

const shutdown = async () => {
  logger.info('Shutting down Codra Node server...');
  if (worker) {
    logger.info('Waiting for active BullMQ jobs to finish...');
    await worker.close();
    logger.info('BullMQ Worker closed gracefully.');
  }
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Trigger restart for env vars
