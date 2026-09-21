import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import type { ApiEnv } from './ports';
import { requireSession } from './middleware/auth';
import { requireCsrfHeader } from './middleware/csrf';
import { observability } from './middleware/observability';
import { createAuthRouter } from './routes/auth';
import { createWebhookRouter } from './routes/webhook';
import { createAuthApiRouter } from './routes/api/auth';
import { createJobsRouter } from './routes/api/jobs';
import { createReposRouter } from './routes/api/repos';
import { createStatsRouter } from './routes/api/stats';
import { createModelsRouter } from './routes/api/models';
import { createSettingsRouter } from './routes/api/settings';

async function serveIndex(c: Context<ApiEnv>) {
  // If the host platform passes an ASSETS binding via `c.env`, use it (e.g., Cloudflare Workers).
  const assets = (c.env as any).ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    // Method call, and `/` not `/index.html`: detaching throws, and `/index.html` 307s into a loop.
    const response = await assets.fetch(new Request(new URL('/', c.req.url), c.req.raw));
    const newResponse = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
    newResponse.headers.set('Cache-Control', 'no-cache');
    return newResponse;
  }

  c.header('Cache-Control', 'no-cache');
  return c.text('Not Found: Please mount UI static assets handler here.', 404);
}

export interface ApiRouterOptions {
  // Cross-cutting request middleware; also sees /webhook and /auth, which the /api/* guards skip.
  beforeAuth?: MiddlewareHandler<ApiEnv>[];
  // Runs on /api/* after the session and CSRF guards, so `sessionUser` is populated.
  afterAuth?: MiddlewareHandler<ApiEnv>[];
  pages?: string[];
  publicPages?: string[];
  // Called last, so paths added under /api/* still inherit the session, CSRF and afterAuth middleware.
  routes?: (app: Hono<ApiEnv>) => void;
}

export function createApiRouter(options: ApiRouterOptions = {}) {
  const app = new Hono<ApiEnv>();

  app.use('*', observability);
  for (const middleware of options.beforeAuth ?? []) {
    app.use('*', middleware);
  }

  // Machine health check — no session required
  app.get('/healthz', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  app.use('/auth/logout', requireSession);
  app.use('/auth/logout', requireCsrfHeader);

  app.route('/auth', createAuthRouter());
  app.route('/webhook', createWebhookRouter());

  app.use('/api/*', requireSession);
  app.use('/api/*', requireCsrfHeader);
  for (const middleware of options.afterAuth ?? []) {
    app.use('/api/*', middleware);
  }

  app.route('/api/auth', createAuthApiRouter());
  app.route('/api/jobs', createJobsRouter());
  app.route('/api/repos', createReposRouter());
  app.route('/api/stats', createStatsRouter());
  app.route('/api/models', createModelsRouter());
  app.route('/api/settings', createSettingsRouter());

  app.get('/login', serveIndex);
  app.get('/', serveIndex); // Unauthenticated landing page
  app.get('/dashboard', requireSession, serveIndex);
  app.get('/jobs', requireSession, serveIndex);
  app.get('/jobs/*', requireSession, serveIndex);
  app.get('/repos', requireSession, serveIndex);
  app.get('/stats', requireSession, serveIndex);
  app.get('/health', requireSession, serveIndex);
  app.get('/settings', requireSession, serveIndex);
  app.get('/account', requireSession, serveIndex);

  for (const path of options.publicPages ?? []) {
    app.get(path, serveIndex);
  }
  for (const path of options.pages ?? []) {
    app.get(path, requireSession, serveIndex);
  }

  options.routes?.(app);

  return app;
}
