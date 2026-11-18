import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
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
        { cause: error },
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
  detached: process.platform !== "win32",
});

let stopping = false;
function killChildTree(signal = "SIGTERM") {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.error || result.status !== 0) child.kill();
    return;
  }

  try {
    // The detached child has its own process group, so terminate npm and the
    // dev server it launched rather than leaving descendants behind.
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") child.kill(signal);
  }
}

function stopChild(signal) {
  if (stopping) return;
  stopping = true;
  killChildTree(signal);
}

process.on("SIGINT", () => stopChild("SIGINT"));
process.on("SIGTERM", () => stopChild("SIGTERM"));

// The exit event is synchronous. Use synchronous process-tree termination so
// an unexpected parent exit cannot orphan the dev server.
process.on("exit", () => killChildTree());

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
