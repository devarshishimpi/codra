import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

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
    include: ["test/**/*.spec.ts", "test/**/*.spec.tsx"],
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
