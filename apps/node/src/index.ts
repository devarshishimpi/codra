import * as dotenv from 'dotenv';
import * as path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '../../.dev.vars') }); // Fallback if running from apps/node
dotenv.config({ path: path.resolve(process.cwd(), '.dev.vars') }); // Root level
import { serve } from '@hono/node-server';
import { createApiRouter } from '@codraoss/api';
import { closeDb } from '@codraoss/db/client';
import { InMemorySessionStore } from '@codraoss/core/ports';
import { createNodeApiDeps } from './api-deps';
import { createNodeEnv, type NodeAppBindings } from './env';
import { logger } from '@codraoss/api/logger';
import Redis from 'ioredis';
import { RedisKVAdapter } from './adapters/redis-kv';
import { Queue } from 'bullmq';
import { RedisQueueAdapter } from './adapters/redis-queue';
import { NodeOrchestrator } from './adapters/node-orchestrator';
import { REVIEW_QUEUE_NAME } from './queue';
import { startWorker } from './worker';

// Both default on, so a single container is the whole deployment. Setting one to 'false' splits the
// API and the review workers across containers that scale independently.
const runApi = process.env.START_API !== 'false';
const runWorker = process.env.START_WORKER !== 'false';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisClient = new Redis(redisUrl, { maxRetriesPerRequest: null }); // maxRetriesPerRequest: null is required for bullmq
redisClient.on('error', (err) => {
  logger.error('[Redis Error]', err);
});

// Without these a job gets exactly one attempt: BullMQ defaults to attempts: 0, and its retry check
// is `attemptsMade + 1 < opts.attempts`. The engine's own try block does not cover resolving the job,
// the admission query or claiming the lease, so a transient Postgres error there would escape and
// strand the row with nothing to revisit it. Mirrors the Cloudflare driver, which runs each phase
// under `retries: { limit: 5, delay: '60 seconds', backoff: 'exponential' }`. UnrecoverableError
// still bypasses this, so an unparseable payload fails once.
// Completed and failed jobs are trimmed so a long-lived install does not grow Redis without bound.
const reviewQueue = new Queue(REVIEW_QUEUE_NAME, {
  connection: redisClient,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

const env: NodeAppBindings = createNodeEnv({
  SESSION_STORE: new InMemorySessionStore(),
  APP_KV: new RedisKVAdapter(redisClient),
  REVIEW_QUEUE: new RedisQueueAdapter(reviewQueue),
  // Delegates rather than holding the instance, because the orchestrator needs the env being built
  // here. The closure only runs once a job is in hand, by which point `orchestrator` is assigned.
  REVIEW_ORCHESTRATOR: { startReviewJob: (id, params) => orchestrator.startReviewJob(id, params) },
});

const orchestrator = new NodeOrchestrator(env);

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

const server = runApi
  ? serve({
      fetch: async (request) => {
        const apiEnv = {
          ...envWithAssets,
          deps: createNodeApiDeps(env),
        };
        // No runWithDb: it opens a postgres pool per call and never ends it, so wrapping the
        // request path leaked a connection per request. getDb falls back to the process-wide pool.
        try { return await app.fetch(request, apiEnv as any); } catch (e) { console.error('SERVE ERROR:', e); throw e; }
      },
      port,
    }, (info) => {
      logger.info(`Codra Node server running on http://localhost:${info.port}`);
    })
  : null;

const reviewWorker = runWorker ? startWorker(env, redisUrl) : null;
if (reviewWorker) logger.info(`Codra review worker listening on queue ${REVIEW_QUEUE_NAME}`);
if (!server && !reviewWorker) {
  logger.error('START_API and START_WORKER are both false: nothing to run');
  process.exit(1);
}

// worker.close() waits for the review in flight to finish, so a redeploy does not abandon a job
// mid-phase with its lease still held.
// Long enough to outlast a review phase: worker.close() waits for the job in flight, and model
// calls plus the engine's inter-phase sleeps run to minutes. Too short a budget and every redeploy
// kills a running review, leaving its row 'running' with the lease still held.
// Docker caps this independently -- raise stop_grace_period past it, or the container is killed first.
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 300_000);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);

  // No process.exit() on the happy path: it discards buffered stdout, so the shutdown log lines are
  // lost exactly when an operator needs them. Closing every handle lets the loop drain and Node
  // exit 0 on its own; the timer is the backstop for a close that never resolves, and unref() keeps
  // it from holding the process open by itself.
  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out, exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // Stop accepting, drop sockets sitting idle on keep-alive, then let the worker finish the review
    // it is holding before the remaining sockets are cut.
    server?.close();
    if (server && 'closeIdleConnections' in server) server.closeIdleConnections();
    await reviewWorker?.close();
    if (server && 'closeAllConnections' in server) server.closeAllConnections();
    await reviewQueue.close();
    redisClient.disconnect();
    // The pooled Postgres socket is an active handle: without ending it the process stays up after
    // everything else has closed.
    await closeDb();
    clearTimeout(forceExit);
  } catch (error) {
    logger.error('Error during shutdown', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));













// Trigger restart for env vars
