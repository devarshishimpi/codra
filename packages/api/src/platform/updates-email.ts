import type { KvCompat } from './kv';

const EMAILS_API_URL = 'https://codra.run/api/emails';

type UpdatesEmailRecord = {
  status: 'subscribed';
  email: string;
  updatedAt: string;
};

function updatesEmailKey(githubUserId: number) {
  return `updates-email:${githubUserId}`;
}

export async function getUpdatesEmailPreference(
  kv: KvCompat,
  githubUserId: number,
) {
  return await kv.get(updatesEmailKey(githubUserId), 'json') as UpdatesEmailRecord | null;
}

async function hasUpdatesEmailPreference(
  kv: KvCompat,
  githubUserId: number,
) {
  return Boolean(await getUpdatesEmailPreference(kv, githubUserId));
}

export async function syncUpdatesEmail(
  kv: KvCompat,
  githubUserId: number,
  email: string | null | undefined,
) {
  if (!email) return false;

  if (await hasUpdatesEmailPreference(kv, githubUserId)) return false;

  const response = await fetch(EMAILS_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    // Need to import logger. If it doesn't exist in the current scope, add it.
    // import { logger } from '../logger'; // Uncomment and adjust path if needed
    console.warn('Failed to sync updates email', { status: response.status, url: response.url }); // Using console.warn as a fallback, replace with logger.warn if imported
    return false;
  }

  const record: UpdatesEmailRecord = {
    status: 'subscribed',
    email,
    updatedAt: new Date().toISOString(),
  };
  await kv.put(updatesEmailKey(githubUserId), JSON.stringify(record));

  return true;
}
