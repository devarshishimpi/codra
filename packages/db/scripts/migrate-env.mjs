import { readFile } from "node:fs/promises";
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
