// SSRF guard for custom provider base URLs.
import { ProviderRequestError } from "./types";

const PRIVATE_HOST_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^localhost$/i,
  // IPv6 loopback, local, IPv4-mapped
  /^::1?$/,
  /^f[cd][0-9a-f]{2}:/i,
  /^fe[89ab][0-9a-f]:/i,
  /^::ffff:/i,
];

// Cloud instance-metadata endpoints, which are public-looking but reachable only from inside.
const METADATA_HOSTS = new Set(["metadata.google.internal", "100.100.100.200"]);

export function isPrivateHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

export function isValidPublicUrl(urlString: string) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (METADATA_HOSTS.has(url.hostname.toLowerCase())) return false;
    return !isPrivateHost(url.hostname);
  } catch {
    return false;
  }
}

export function assertPublicBaseUrl(
  baseUrl: string | null | undefined,
  providerName: string,
) {
  if (baseUrl && !isValidPublicUrl(baseUrl)) {
    throw new ProviderRequestError(
      providerName,
      400,
      "Invalid provider base URL.",
    );
  }
}
