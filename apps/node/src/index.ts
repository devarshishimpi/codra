import * as dotenv from 'dotenv';
import * as path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '../../.dev.vars') }); // Fallback if running from apps/node
dotenv.config({ path: path.resolve(process.cwd(), '.dev.vars') }); // Root level
import { serve } from '@hono/node-server';
import { createApiRouter } from '@codraoss/api';
import { runWithDb } from '@codraoss/db/client';
import { InMemoryKV, InMemoryQueue, InMemoryOrchestrator, InMemorySessionStore } from '@codraoss/core/ports';
import { createNodeApiDeps } from './api-deps';
import { createNodeEnv } from './env';
import { logger } from '@codraoss/api/logger';

const stubs = {
  SESSION_STORE: new InMemorySessionStore(),
  APP_KV: new InMemoryKV(),
  REVIEW_QUEUE: new InMemoryQueue(),
  REVIEW_ORCHESTRATOR: new InMemoryOrchestrator(),
};

const env = createNodeEnv(stubs);

import fs from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';

const dashboardDist = path.resolve(process.cwd(), process.cwd().endsWith('node') ? '../../dist/client' : 'dist/client');

const envWithAssets = {
  ...env,
  ASSETS: {
    fetch: async (req: Request) => {
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

serve({
  fetch: async (request) => {
    const apiEnv = {
      ...envWithAssets,
      deps: createNodeApiDeps(env),
    };
    try { console.log('envWithAssets:', Object.keys(envWithAssets), 'HYPERDRIVE:', envWithAssets.HYPERDRIVE); return await runWithDb(envWithAssets, () => app.fetch(request, apiEnv as any)); } catch (e) { console.error('SERVE ERROR:', e); throw e; }
  },
  port,
}, (info) => {
  logger.info(`Codra Node server running on http://localhost:${info.port}`);
});













// Trigger restart for env vars
