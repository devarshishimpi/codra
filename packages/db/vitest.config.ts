import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts", "test/**/*.contract.ts"],
    environment: "node",
    globals: false,
    passWithNoTests: true,
  },
});
