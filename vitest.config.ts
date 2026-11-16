import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export const INTEGRATION_TEST_PATTERNS = [
  "test/db/**/*.spec.ts",
  "test/jsonb-encoding.spec.ts",
  "test/findings/suppression.spec.ts",
  "test/api/auth.spec.ts",
  "test/api/authorize.spec.ts",
  "test/api/jobs.spec.ts",
  "test/api/quota.spec.ts",
  "test/api/repos.spec.ts",
  "test/api/router-options.spec.ts",
  "test/api/webhook-handling.spec.ts",
  "test/review/async-batch.spec.ts",
  "test/review/batch-flow.spec.ts",
  "test/review/flow-chunking.spec.ts",
  "test/review/flow-lifecycle.spec.ts",
  "test/review/flow-retry.spec.ts",
  "test/review/quota-deferral.spec.ts",
  "test/review/resumable-queue.spec.ts",
  "test/comment-feedback.spec.ts",
  "test/**/*.integration.spec.ts",
];

const testSuite = process.env.CODRA_TEST_SUITE;

const testInclude =
  testSuite === "integration"
    ? INTEGRATION_TEST_PATTERNS
    : ["test/**/*.spec.ts", "test/**/*.spec.tsx"];

const testExclude =
  testSuite === "unit"
    ? ["**/node_modules/**", "**/dist/**", ...INTEGRATION_TEST_PATTERNS]
    : ["**/node_modules/**", "**/dist/**"];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@server": resolve(__dirname, "./apps/worker/src"),
      "@client": resolve(__dirname, "./apps/dashboard/src"),
      "@": resolve(__dirname, "./apps/dashboard/src"),
      "cloudflare:workers": resolve(
        __dirname,
        "./test/mocks/cloudflare-workers.ts",
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: testInclude,
    exclude: testExclude,
    passWithNoTests: true,
    setupFiles: [resolve(__dirname, "./test/setup.ts")],
    // The suite is dominated by round trips to a remote Postgres, so wall clock is latency-bound,
    // not CPU-bound: running files concurrently overlaps the waiting. Safe because DB-backed suites
    // isolate by unique row names (see `uniqueName`) and nothing truncates a shared table.
    //
    // Capped rather than unbounded. Every worker opens its own pooled connection, and a free-tier
    // Neon project has a small connection ceiling; past it the failure is a connection error that
    // looks like a test bug.
    fileParallelism: true,
    maxWorkers: 6,
  },
});
