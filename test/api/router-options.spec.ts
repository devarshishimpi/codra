import { createApiRouter } from '@codraoss/api';
import type { AppBindings } from '@server/env';

import { createTestEnv, dbDescribe } from '../helpers';

dbDescribe('createApiRouter options', () => {
  async function signIn(app: ReturnType<typeof createApiRouter>, env: AppBindings) {
    if (env.IDENTITY_PROVIDER && 'defaultUser' in env.IDENTITY_PROVIDER) {
      (env.IDENTITY_PROVIDER as any).defaultUser = {
        provider: 'github',
        providerUserId: '42',
        login: 'devarshishimpi',
        name: 'Devarshi Shimpi',
        avatarUrl: null,
        email: null,
        signedInAt: new Date().toISOString(),
        metadata: { githubUserId: 42, githubUsername: 'devarshishimpi' },
      };
    }
    const authStart = await app.request('/auth/github', {}, env);
    const location = authStart.headers.get('location');
    const state = location ? new URL(location).searchParams.get('state') : null;
    const callback = await app.request(`/auth/github/callback?code=test-code&state=${state}`, {}, env);
    const match = (callback.headers.get('set-cookie') || '').match(/codra_session=([^;]+)/);
    return match ? match[1] : '';
  }

  it('inherits the session and CSRF guards on routes mounted through options', async () => {
    const app = createApiRouter({
      routes: (extended) => {
        extended.get('/api/admin/ping', (c) => c.json({ ok: true }));
      },
    });
    const env = createTestEnv();

    const anonymous = await app.request('/api/admin/ping', {}, env);
    expect(anonymous.status).toBe(401);

    const token = await signIn(app, env);
    const authorized = await app.request('/api/admin/ping', {
      headers: { Cookie: `codra_session=${token}`, 'x-requested-with': 'XMLHttpRequest' },
    }, env);

    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toEqual({ ok: true });
  });

  it('runs beforeAuth middleware on unauthenticated paths such as the webhook', async () => {
    const seen: string[] = [];
    const app = createApiRouter({
      beforeAuth: [async (c, next) => { seen.push(new URL(c.req.url).pathname); await next(); }],
    });
    const env = createTestEnv();

    await app.request('http://codra.test/webhook', { method: 'POST', body: '{}' }, env);
    await app.request('http://codra.test/api/stats', {}, env);

    expect(seen).toEqual(['/webhook', '/api/stats']);
  });

  it('gates extra pages behind the session and serves public ones openly', async () => {
    const app = createApiRouter({ pages: ['/admin'], publicPages: ['/pricing'] });
    const env = createTestEnv();

    const gated = await app.request('/admin', { headers: { accept: 'text/html' } }, env);
    expect(gated.status).toBe(302);
    expect(gated.headers.get('location')).toBe('/');

    const open = await app.request('/pricing', { headers: { accept: 'text/html' } }, env);
    expect(open.status).toBe(200);

    const token = await signIn(app, env);
    const authorized = await app.request('/admin', {
      headers: { accept: 'text/html', Cookie: `codra_session=${token}` },
    }, env);
    expect(authorized.status).toBe(200);
  });

  it('keeps the no-argument router unchanged', async () => {
    const app = createApiRouter();
    const env = createTestEnv();

    expect((await app.request('/api/admin/ping', {}, env)).status).toBe(401);
    expect((await app.request('/nope-not-a-route', {}, env)).status).toBe(404);
  });
});
