import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(rootDir, ".env.e2e");

const REQUIRED_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "GITHUB_APP_ID",
  "GITHUB_APP_WEBHOOK_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "AUTH_CALLBACK_URL",
  "APP_URL",
  "LLM_CONFIG_ENCRYPTION_KEY",
];

const ALLOWED_E2E_KEYS = new Set([
  ...REQUIRED_KEYS,
  "PORT",
  "GITHUB_APP_SLUG",
  "DASHBOARD_ALLOWED_USERS",
  "BOT_USERNAME",
  "ENVIRONMENT",
  "START_API",
  "START_WORKER",
  "TELEMETRY_DISABLED",
]);

const SENSITIVE_KEYS = new Set(["NODE_OPTIONS", "PATH", "SHELL"]);

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

  const parsedEnv = {};
  const fileKeys = new Set();
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    if (SENSITIVE_KEYS.has(key.toUpperCase()) || !ALLOWED_E2E_KEYS.has(key)) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // .env.e2e provides isolated disposable credentials for e2e tests
    const cleanValue = value.replace(/\\n/g, "\n");
    process.env[key] = cleanValue;
    parsedEnv[key] = cleanValue;
    fileKeys.add(key);
  }

  // When .env.e2e is present, require all mandatory keys in the file itself
  // to avoid silently leaking ambient developer infrastructure
  const missingInFile = REQUIRED_KEYS.filter((k) => !fileKeys.has(k));
  if (missingInFile.length > 0) {
    throw new Error(
      `.env.e2e is missing required keys: ${missingInFile.join(", ")}. Populate these in .env.e2e to ensure test isolation.`,
    );
  }

  return parsedEnv;
}

const parsedEnv = loadE2eEnvironment();

for (const key of REQUIRED_KEYS) {
  if (!process.env[key]) {
    throw new Error(`Missing ${key} in .env.e2e or environment`);
  }
}

// The smoke test never exercises GitHub signing. Generate a disposable key so
// server initialization cannot accidentally use a developer's real app key.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
// Baseline system environment keys needed for process execution
const ALLOWED_SYSTEM_KEYS = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TMP",
  "TEMP",
  "HOME",
  "USERPROFILE",
]);

const childEnv = {};
for (const [key, val] of Object.entries(process.env)) {
  if (ALLOWED_SYSTEM_KEYS.has(key.toUpperCase())) {
    childEnv[key] = val;
  }
}
for (const [key, val] of Object.entries(parsedEnv)) {
  childEnv[key] = val;
}
childEnv.APP_PRIVATE_KEY = privateKey;
childEnv.START_API = "true";
childEnv.START_WORKER = "false";
childEnv.TELEMETRY_DISABLED = "true";
childEnv.NODE_ENV = "test";

// Spawn the built Node server entrypoint directly rather than through tsup --watch
const serverEntry = path.join(rootDir, "apps", "node", "dist", "index.js");
if (!existsSync(serverEntry)) {
  console.error(
    `Missing compiled server entrypoint at ${serverEntry}.\nPlease run 'npm run build:node' first.`,
  );
  process.exit(1);
}

const child = spawn(process.execPath, [serverEntry], {
  cwd: rootDir,
  env: childEnv,
  stdio: "inherit",
});

let stopping = false;
let killed = false;
function killChildTree(signal = "SIGTERM") {
  if (killed || !child.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.error || result.status !== 0) child.kill();
    killed = true;
    return;
  }

  try {
    child.kill(signal);
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process already terminated
        }
      }
    }, 6000).unref();
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process already terminated
      }
    }
  }
  killed = true;
}

function stopChild(signal) {
  if (stopping) return;
  stopping = true;
  killChildTree(signal);
}

process.on("SIGINT", () => stopChild("SIGINT"));
process.on("SIGTERM", () => stopChild("SIGTERM"));

// The exit event is synchronous. Best-effort child termination so
// an unexpected parent exit cannot orphan the server.
process.on("exit", () => killChildTree());

child.on("error", (error) => {
  console.error("Failed to start the Codra Node server:", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (stopping) {
    process.exitCode = 0;
    return;
  }
  process.exitCode = code ?? (signal ? 1 : 0);
});
