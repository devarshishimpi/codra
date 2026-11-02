import { hexToBytes } from "@codraoss/schema/hex";

const encoder = new TextEncoder();

export async function verifyGitHubWebhookSignature(
  secret: string,
  headerValue: string | null,
  rawBody: string,
) {
  if (!headerValue?.startsWith("sha256=")) {
    return false;
  }

  const signature = headerValue.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(signature),
    encoder.encode(rawBody),
  );
}
