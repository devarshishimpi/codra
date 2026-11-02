import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// cwd is checked first so the script works when run from node_modules, where the script-relative path would resolve inside node_modules; the script-relative fallback still finds root env files from a monorepo subdirectory.
const cwdDir = process.cwd();
const scriptRelativeDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const searchDirs =
  cwdDir === scriptRelativeDir ? [cwdDir] : [cwdDir, scriptRelativeDir];

export function parseEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export async function readDatabaseUrlFromEnvFiles() {
  const envFiles = [".dev.vars", ".env.local", ".env"];

  for (const dir of searchDirs) {
    for (const file of envFiles) {
      try {
        const content = await readFile(path.join(dir, file), "utf8");
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;

          const separatorIndex = trimmed.indexOf("=");
          if (separatorIndex === -1) continue;

          const key = trimmed.slice(0, separatorIndex).trim();
          if (key === "DATABASE_URL") {
            return parseEnvValue(trimmed.slice(separatorIndex + 1));
          }
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  return null;
}

/**
 * Determines whether a database connection URL requires a preflight DNS lookup.
 * Returns false for Unix domain sockets (standard libpq percent-encoded paths),
 * omitted hosts, IP addresses, and unparseable connection strings.
 */
export function shouldPerformDnsLookup(databaseUrl) {
  if (!databaseUrl) return false;
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  const host = url.hostname;
  if (!host) return false;

  let decodedHost;
  try {
    decodedHost = decodeURIComponent(host);
  } catch {
    decodedHost = host;
  }

  // Unix domain sockets in libpq URLs are encoded as %2F... or start with /
  if (
    host.startsWith("%2F") ||
    host.startsWith("/") ||
    decodedHost.startsWith("/")
  ) {
    return false;
  }

  // IPv4 or IPv6 literals do not require DNS resolution
  const cleanHost = host.replace(/^\[|\]$/g, "");
  if (isIP(cleanHost) !== 0) {
    return false;
  }

  return true;
}

