import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

function loadE2eEnv(): Record<string, string> {
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(rootDir, ".env.e2e");
  try {
    const content = readFileSync(envPath, "utf8");
    const parsed: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        let val = trimmed.slice(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        parsed[trimmed.slice(0, idx).trim()] = val;
      }
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

const e2eEnv = loadE2eEnv();
const port = e2eEnv.PORT || process.env.PORT || "3000";
let baseURL = `http://localhost:${port}`;
// Prioritize .env.e2e APP_URL over ambient environment to preserve isolation
const configuredUrl = e2eEnv.APP_URL || process.env.APP_URL;
if (configuredUrl) {
  try {
    const parsedUrl = new URL(configuredUrl);
    if (parsedUrl.protocol !== "http:") {
      throw new Error(`E2E APP_URL must use http: protocol, got "${parsedUrl.protocol}".`);
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error("E2E APP_URL must not contain authentication credentials.");
    }
    if (parsedUrl.pathname !== "/" && parsedUrl.pathname !== "") {
      throw new Error(`E2E APP_URL must not include a path, got "${parsedUrl.pathname}".`);
    }
    if (parsedUrl.search || parsedUrl.hash) {
      throw new Error("E2E APP_URL must not include query parameters or hash fragments.");
    }
    if (parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
      throw new Error(
        `E2E APP_URL must point to a loopback address (localhost or 127.0.0.1), got "${configuredUrl}".`,
      );
    }
    parsedUrl.port = port;
    baseURL = parsedUrl.origin;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("E2E APP_URL")) {
      throw err;
    }
    throw new Error(`Invalid APP_URL in e2e configuration: "${configuredUrl}"`, { cause: err });
  }
}

export default defineConfig({
  testDir: "./playwright",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node scripts/start-e2e-server.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
