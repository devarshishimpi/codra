import { exec, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Pure-ish leaves of the Cloudflare setup script (process spawning, id extraction, .dev.vars
// I/O). No handles held across calls, so importing this has no side effects; the imperative
// provisioning flow stays in setup-cloudflare.js.

// The Worker's own package -- and its wrangler.jsonc -- live under apps/worker in the monorepo.
// `.dev.vars` stays at the repo root (see dev:worker's --env-file ../../.dev.vars), so only the
// wrangler config path moves.
export const WORKER_DIR = path.join(process.cwd(), "apps", "worker");
export const WRANGLER_JSONC_PATH = path.join(WORKER_DIR, "wrangler.jsonc");
export const DEV_VARS_PATH = path.join(process.cwd(), ".dev.vars");

export function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? `${command}.cmd` : command,
      args,
      { cwd: WORKER_DIR, ...options },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout });
      else {
        const err = new Error(`Command failed with code ${code}`);
        err.stderr = stderr;
        reject(err);
      }
    });
    child.on("error", (err) => reject(err));
  });
}

export function extractId(output) {
  const match = output.match(/[a-f0-9]{32}/);
  return match ? match[0] : null;
}

export function getEnvVars() {
  const env = {};
  if (fs.existsSync(DEV_VARS_PATH)) {
    const content = fs.readFileSync(DEV_VARS_PATH, "utf-8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim() && !line.startsWith("#")) {
        const [key, ...values] = line.split("=");
        if (key && values.length > 0) {
          // Unescape literal \n: wrangler secrets need real newlines, not the two chars \ and n.
          const raw = values.join("=").trim().replace(/^"|"$/g, "");
          env[key.trim()] = raw.replace(/\\n/g, "\n");
        }
      }
    }
  }
  return env;
}

export function setSecret(secretName, secretValue) {
  return new Promise((resolve, reject) => {
    // `wrangler secret put` needs the worker's own config to know which script to attach to.
    const child = exec(
      `npx wrangler secret put ${secretName}`,
      { cwd: WORKER_DIR },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve();
      },
    );

    child.stdin.write(secretValue);
    child.stdin.end();
  });
}
