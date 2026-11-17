import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.e2e");

function loadE2eEnvironment() {
  let source;
  try {
    source = readFileSync(envPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(
        "Missing .env.e2e. Copy .env.e2e.example to .env.e2e and start the disposable Postgres and Redis services first.",
      );
    }
    throw error;
  }

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, "\n");
  }
}

loadE2eEnvironment();

for (const key of ["DATABASE_URL", "REDIS_URL", "GITHUB_APP_ID", "GITHUB_APP_WEBHOOK_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "AUTH_CALLBACK_URL", "APP_URL", "LLM_CONFIG_ENCRYPTION_KEY"]) {
  if (!process.env[key]) {
    throw new Error(`Missing ${key} in .env.e2e`);
  }
}

// The smoke test never exercises GitHub signing. Generate a disposable key so
// server initialization cannot accidentally use a developer's real app key.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.APP_PRIVATE_KEY = privateKey;
process.env.START_API = "true";
process.env.START_WORKER = "false";
process.env.TELEMETRY_DISABLED = "true";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npm, ["run", "dev:node"], {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

let stopping = false;
function stopChild(signal) {
  if (stopping || child.exitCode !== null) return;
  stopping = true;

  if (process.platform === "win32" && child.pid) {
    const taskkill = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    taskkill.on("error", () => child.kill());
  } else {
    child.kill(signal);
  }
}

process.on("SIGINT", () => stopChild("SIGINT"));
process.on("SIGTERM", () => stopChild("SIGTERM"));

child.on("error", (error) => {
  console.error("Failed to start the Codra Node server:", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal && !stopping) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? (stopping ? 0 : 1);
});
