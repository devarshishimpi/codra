// DO NOT SPLIT THE REVIEW-SETTINGS TESTS OUT OF THIS FILE.
//
// The settings suites here read-modify-write the same singleton `global_settings` row set. In
// separate files they race, because `fileParallelism` is on and no unique row name can isolate a
// single-row key/value table -- the trick every other suite uses (see `uniqueName`) does not apply.
// That is why this file is over the max-lines limit and carries an explicit eslint override rather
// than being divided; the account/session half could move out, but the settings half cannot.

import { getReviewSettings, updateReviewSettings } from '@codraoss/db/app-settings';
import { reviewMaxFilesRange } from '@codraoss/schema';
import { createApiRouter } from '@codraoss/api';

import { queryRows, runWithDb } from '@codraoss/db/client';

import { syncUpdatesEmail } from '@server/core/updates-email';

import type { AccountResponse, JobsResponse, UpdatesEmailResponse } from '@codraoss/schema/api';
import { createTestEnv, dbDescribe } from '../helpers';
import { vi } from 'vitest';

describe('Dashboard API: auth, session and account', () => {
  const app = createApiRouter();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function getAuthCookie(env = createTestEnv(), login = 'devarshishimpi', githubUserId = 42) {
    if (env.IDENTITY_PROVIDER && 'defaultUser' in env.IDENTITY_PROVIDER) {
      (env.IDENTITY_PROVIDER as any).defaultUser = {
        provider: 'github',
        providerUserId: githubUserId.toString(),
        login,
        name: 'Devarshi Shimpi',
        avatarUrl: `https://avatars.githubusercontent.com/u/${githubUserId}`,
        email: null,
        signedInAt: new Date().toISOString(),
        metadata: {
          githubUserId,
          githubUsername: login,
        },
      };
    }

    const authStart = await app.request('/auth/github', {}, env);
    const authLocation = authStart.headers.get('location');
    expect(authStart.status).toBe(302);
    expect(authLocation).toBeTruthy();

    const state = authLocation ? new URL(authLocation).searchParams.get('state') : null;
    expect(state).toBeTruthy();

    const callback = await app.request(`/auth/github/callback?code=test-code&state=${state}`, {}, env);
    const cookieHeader = callback.headers.get('set-cookie') || '';
    const match = cookieHeader.match(/codra_session=([^;]+)/);

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/dashboard');

    return match ? match[1] : '';
  }

  it('denies access to /api/jobs without a session', async () => {
    const env = createTestEnv();
    const response = await app.request('/api/jobs', {}, env);
    expect(response.status).toBe(401);
  });

  it('starts GitHub OAuth with the configured callback and scope', async () => {
    const env = createTestEnv();
    const response = await app.request('/auth/github', {}, env);

    expect(response.status).toBe(302);

    const location = response.headers.get('location');
    expect(location).toBeTruthy();

    const url = new URL(location!);
    expect(url.origin + url.pathname).toBe('https://fake-provider.com/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe(env.AUTH_CALLBACK_URL);
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('rejects GitHub users outside the allowlist', async () => {
    const env = createTestEnv({ DASHBOARD_ALLOWED_USERS: 'someoneelse' });
    if (env.IDENTITY_PROVIDER && 'defaultUser' in env.IDENTITY_PROVIDER) {
      (env.IDENTITY_PROVIDER as any).defaultUser.login = 'devarshishimpi';
    }

    const authStart = await app.request('/auth/github', {}, env);
    const state = new URL(authStart.headers.get('location')!).searchParams.get('state');
    const response = await app.request(`/auth/github/callback?code=test-code&state=${state}`, {}, env);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/login?error=not_allowed');
  });

  it('allows access to /api/jobs with a valid GitHub session', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);
    const response = await app.request('/api/jobs', {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as JobsResponse;
    expect(Array.isArray(data.jobs)).toBe(true);
  });

  it('rejects authenticated state-changing API requests without the CSRF header', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/jobs/non-existent-id/retry', {
      method: 'POST',
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(403);
  });

  it('allows authenticated state-changing API requests with the CSRF header', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    const response = await app.request('/api/jobs/non-existent-id/retry', {
      method: 'POST',
      headers: {
        Cookie: `codra_session=${token}`,
        'x-requested-with': 'XMLHttpRequest',
      },
    }, env);

    expect(response.status).toBe(404);
  });

  it('preserves omitted review settings when patching a single setting', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);
    const headers = {
      Cookie: `codra_session=${token}`,
      'x-requested-with': 'XMLHttpRequest',
      'content-type': 'application/json',
    };

    try {
      const seed = await app.request('/api/settings', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ concurrencyLevel: 'low', maxComments: 5 }),
      }, env);
      expect(seed.status).toBe(200);

      const commentsOnly = await app.request('/api/settings', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ maxComments: 20 }),
      }, env);
      expect(commentsOnly.status).toBe(200);

      const afterCommentsOnly = await app.request('/api/settings', {
        headers: { Cookie: `codra_session=${token}` },
      }, env);
      expect(afterCommentsOnly.status).toBe(200);
      await expect(afterCommentsOnly.json()).resolves.toMatchObject({
        settings: { concurrencyLevel: 'low', maxComments: 20 },
      });

      const concurrencyOnly = await app.request('/api/settings', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ concurrencyLevel: 'high' }),
      }, env);
      expect(concurrencyOnly.status).toBe(200);

      const afterConcurrencyOnly = await app.request('/api/settings', {
        headers: { Cookie: `codra_session=${token}` },
      }, env);
      expect(afterConcurrencyOnly.status).toBe(200);
      await expect(afterConcurrencyOnly.json()).resolves.toMatchObject({
        settings: { concurrencyLevel: 'high', maxComments: 20 },
      });
    } finally {
      await app.request('/api/settings', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ concurrencyLevel: 'medium', maxComments: 10 }),
      }, env);
    }
  });

  it('falls back invalid stored review settings independently', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);

    try {
      await queryRows(
        env,
        `INSERT INTO global_settings (key, value) VALUES
          ('review_concurrency_level', 'turbo'),
          ('review_max_comments', '20')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      );

      const invalidConcurrency = await app.request('/api/settings', {
        headers: { Cookie: `codra_session=${token}` },
      }, env);
      expect(invalidConcurrency.status).toBe(200);
      await expect(invalidConcurrency.json()).resolves.toMatchObject({
        settings: { concurrencyLevel: 'medium', maxComments: 20 },
      });

      await queryRows(
        env,
        `INSERT INTO global_settings (key, value) VALUES
          ('review_concurrency_level', 'high'),
          ('review_max_comments', '999')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      );

      const invalidComments = await app.request('/api/settings', {
        headers: { Cookie: `codra_session=${token}` },
      }, env);
      expect(invalidComments.status).toBe(200);
      await expect(invalidComments.json()).resolves.toMatchObject({
        settings: { concurrencyLevel: 'high', maxComments: 10 },
      });
    } finally {
      await queryRows(
        env,
        `INSERT INTO global_settings (key, value) VALUES
          ('review_concurrency_level', 'medium'),
          ('review_max_comments', '10')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      );
    }
  });

  it('persists and returns a durable account record with a unique account id', async () => {
    const env = createTestEnv();
    // Own github_user_id: this asserts a pristine record, so it must not share a
    // row with the tests that rename it or set a timezone.
    const token = await getAuthCookie(env, 'devarshishimpi', 4300);

    const response = await app.request('/api/auth/account', {
      headers: { Cookie: `codra_session=${token}` },
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as AccountResponse;
    expect(data.account.githubUserId).toBe(4300);
    expect(data.account.githubUsername).toBe('devarshishimpi');
    expect(data.account.accountName).toBe('Devarshi Shimpi');
    expect(typeof data.account.id).toBe('string');
    expect(data.account.id.length).toBeGreaterThan(0);
  });

  it.each([
    ['updates the editable account display name', { name: 'Renamed Codra User' }, 200, (data: AccountResponse) => expect(data.account.accountName).toBe('Renamed Codra User')],
    ['persists a display time zone', { timezone: 'Asia/Kolkata' }, 200, (data: AccountResponse) => expect(data.account.timezone).toBe('Asia/Kolkata')],
    ['clears display time zone back to default', { timezone: null }, 200, (data: AccountResponse) => expect(data.account.timezone).toBeNull()],
    ['rejects an unknown time zone', { timezone: 'Mars/Olympus_Mons' }, 400, () => {}],
    ['rejects an empty account name', { name: '   ' }, 400, () => {}]
  ])('%s', async (name, payload, expectedStatus, assertFn) => {
    const env = createTestEnv();
    const token = await getAuthCookie(env, 'devarshishimpi', 4310);
    
    const response = await app.request('/api/auth/account', {
      method: 'PATCH',
      headers: { Cookie: `codra_session=${token}`, 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify(payload),
    }, env);
    
    expect(response.status).toBe(expectedStatus);
    
    if (expectedStatus === 200) {
      const data = await response.json() as AccountResponse;
      assertFn(data);
      
      const followUp = await app.request('/api/auth/account', {
        headers: { Cookie: `codra_session=${token}` },
      }, env);
      const followUpData = await followUp.json() as AccountResponse;
      assertFn(followUpData);
    }
  });

  it('keeps a user-set display name when the OAuth upsert runs again', async () => {
    const env = createTestEnv();
    // Own github_user_id: this test renames the persisted row.
    const token = await getAuthCookie(env, 'devarshishimpi', 4302);
    const headers = {
      Cookie: `codra_session=${token}`,
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
    };

    await app.request('/api/auth/account', {
      method: 'PATCH', headers, body: JSON.stringify({ name: 'My Chosen Name' }),
    }, env);

    // Signing in again re-runs upsertAccountSettings with the GitHub profile name.
    await getAuthCookie(env, 'devarshishimpi', 4302);

    const read = await app.request('/api/auth/account', { headers }, env);
    expect(((await read.json()) as AccountResponse).account.accountName).toBe('My Chosen Name');
  });

  it('syncs an updates email only once per GitHub user', async () => {
    const env = createTestEnv();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    await expect(syncUpdatesEmail(env.APP_KV, 42, 'user@example.com')).resolves.toBe(true);
    await expect(syncUpdatesEmail(env.APP_KV, 42, 'user@example.com')).resolves.toBe(false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://codra.run/api/emails', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
    }));
  });

  it('subscribes the user-entered updates email and persists it', async () => {
    const env = createTestEnv();
    const token = await getAuthCookie(env);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ok: true }));

    const response = await app.request('/api/auth/updates-email', {
      method: 'POST',
      headers: {
        Cookie: `codra_session=${token}`,
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: JSON.stringify({ email: 'typed@example.com' }),
    }, env);

    expect(response.status).toBe(200);
    const data = await response.json() as UpdatesEmailResponse;
    expect(data.status).toBe('subscribed');
    expect(data.email).toBe('typed@example.com');
    expect(data.updatedAt).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith('https://codra.run/api/emails', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'typed@example.com' }),
    }));
  });
});

// Colocated here rather than in review-max-files.spec.ts: same singleton `global_settings` row race.
dbDescribe('review max files persistence', () => {
  const env = createTestEnv();

  // Out-of-range values are clamped into range, not replaced with the default.
  it('clamps an out-of-range stored value instead of falling back to the default', async () => {
    await runWithDb(env, async () => {
      const original = await getReviewSettings(env);
      try {
        await queryRows(
          env,
          `INSERT INTO global_settings (key, value) VALUES ('review_max_files', '9999')
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        );
        expect((await getReviewSettings(env)).maxFiles).toBe(reviewMaxFilesRange.max);

        await queryRows(
          env,
          `UPDATE global_settings SET value = 'not-a-number' WHERE key = 'review_max_files'`,
        );
        expect((await getReviewSettings(env)).maxFiles).toBe(reviewMaxFilesRange.default);
      } finally {
        await updateReviewSettings(env, original);
      }
    });
  });
});




