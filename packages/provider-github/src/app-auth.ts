import type { AppBindingsConfig } from "./service";
import { withTimeout } from "@codraoss/core/timeout";
import { assertResponseOk, installationCacheKey, withRetry } from "./http";
import type {
  GitHubAppRecord,
  GitHubInstallation,
  InstallationTokenCacheRecord,
} from "./types";
import {
  GITHUB_TIMEOUT_MS,
  GITHUB_APP_INSTALL_URL_CACHE_KEY,
} from "./constants";

type AppAuthEnv = AppBindingsConfig;

function encodeDerLength(length: number) {
  if (length < 128) return Uint8Array.of(length);

  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function wrapPkcs1InPkcs8(pkcs1: ArrayBuffer) {
  const algorithm = Uint8Array.from([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01,
    0x01, 0x05, 0x00,
  ]);
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  const octetLength = encodeDerLength(pkcs1.byteLength);
  const octet = new Uint8Array(1 + octetLength.length + pkcs1.byteLength);
  octet[0] = 0x04;
  octet.set(octetLength, 1);
  octet.set(new Uint8Array(pkcs1), 1 + octetLength.length);

  const bodyLength = version.length + algorithm.length + octet.length;
  const sequenceLength = encodeDerLength(bodyLength);
  const result = new Uint8Array(1 + sequenceLength.length + bodyLength);
  result[0] = 0x30;
  result.set(sequenceLength, 1);
  let offset = 1 + sequenceLength.length;
  result.set(version, offset);
  offset += version.length;
  result.set(algorithm, offset);
  offset += algorithm.length;
  result.set(octet, offset);
  return result.buffer;
}

function pemToArrayBuffer(pem: string) {
  const isPkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(pem);
  const base64 = pem
    .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (RSA )?PRIVATE KEY-----/g, "")
    // Handle \n escapes from wrangler secrets.
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return isPkcs1 ? wrapPkcs1InPkcs8(bytes.buffer) : bytes.buffer;
}

function base64UrlEncode(input: string) {
  return btoa(input)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function createGitHubJwt(appId: string, privateKeyPem: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    }),
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const signatureString = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${header}.${payload}.${signatureString}`;
}

// App-level (JWT) endpoint headers.
async function appJwtHeaders(env: AppAuthEnv) {
  const jwt = await createGitHubJwt(env.GITHUB_APP_ID, env.APP_PRIVATE_KEY);
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${jwt}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": env.BOT_USERNAME ?? "codra-bot",
  };
}

export function normalizeGitHubAppSlug(slug: string | undefined) {
  const normalized = slug?.trim().replace(/\[bot\]$/i, "");
  return normalized || null;
}

function installUrlFromSlug(slug: string) {
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
}

export async function readCachedInstallationToken(
  env: AppBindingsConfig,
  installationId: string,
  tracker?: { incrementSubrequests(count?: number): void },
) {
  if (tracker) tracker.incrementSubrequests(1);
  const cached = await env.APP_KV.get(
    installationCacheKey(installationId),
    "json",
  );
  return cached as InstallationTokenCacheRecord | null;
}

export async function writeCachedInstallationToken(
  env: AppBindingsConfig,
  installationId: string,
  record: InstallationTokenCacheRecord,
  tracker?: { incrementSubrequests(count?: number): void },
) {
  const expiresAt = new Date(record.expiresAt).getTime();
  const ttl = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000) - 300);
  if (tracker) tracker.incrementSubrequests(1);
  await env.APP_KV.put(
    installationCacheKey(installationId),
    JSON.stringify(record),
    { expirationTtl: ttl },
  );
}

// Caller wraps in withRetry, avoid nested retries.
export async function fetchInstallationToken(
  env: AppAuthEnv,
  installationId: string,
): Promise<InstallationTokenCacheRecord> {
  const headers = await appJwtHeaders(env);
  const response = await withTimeout(
    "GitHub installation token",
    GITHUB_TIMEOUT_MS,
    (signal) =>
      fetch(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
          method: "POST",
          signal,
          headers,
        },
      ),
  );

  await assertResponseOk(
    response,
    "/app/installations/.../access_tokens",
    "GitHub installation token request",
  );

  const data = (await response.json()) as { token: string; expires_at: string };
  return { token: data.token, expiresAt: data.expires_at };
}

export async function fetchInstallations(
  env: AppAuthEnv,
): Promise<GitHubInstallation[]> {
  return withRetry("listInstallations", async () => {
    const headers = await appJwtHeaders(env);
    const response = await withTimeout(
      "GitHub list installations",
      GITHUB_TIMEOUT_MS,
      (signal) =>
        fetch("https://api.github.com/app/installations", { signal, headers }),
    );

    await assertResponseOk(
      response,
      "/app/installations",
      "GitHub list installations",
    );

    return (await response.json()) as GitHubInstallation[];
  });
}

export async function fetchAppInstallationUrl(
  env: AppBindingsConfig,
): Promise<string> {
  const configuredSlug = normalizeGitHubAppSlug(env.GITHUB_APP_SLUG);
  if (configuredSlug) {
    return installUrlFromSlug(configuredSlug);
  }

  const cached = await env.APP_KV.get(GITHUB_APP_INSTALL_URL_CACHE_KEY);
  if (cached) {
    return cached;
  }

  return withRetry("getAppInstallationUrl", async () => {
    const headers = await appJwtHeaders(env);
    const response = await withTimeout(
      "GitHub app lookup",
      GITHUB_TIMEOUT_MS,
      (signal) => fetch("https://api.github.com/app", { signal, headers }),
    );

    await assertResponseOk(response, "/app", "GitHub app lookup");

    const app = (await response.json()) as GitHubAppRecord;
    const fallbackSlug = normalizeGitHubAppSlug(app.slug);
    const installUrl = app.html_url
      ? `${app.html_url.replace(/\/$/, "")}/installations/new`
      : fallbackSlug
        ? installUrlFromSlug(fallbackSlug)
        : null;

    if (!installUrl) {
      throw new Error("GitHub app lookup did not return a usable app URL.");
    }

    await env.APP_KV.put(GITHUB_APP_INSTALL_URL_CACHE_KEY, installUrl, {
      expirationTtl: 60 * 60 * 24,
    });
    return installUrl;
  });
}
