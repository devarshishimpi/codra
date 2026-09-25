import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(rootDir, "package.json"), "utf-8"),
);

export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  // The dashboard app is the Vite root, so publicDir and outDir stay absolute and output still lands at the repo root where wrangler.jsonc expects ../../dist/client.
  root: path.resolve(rootDir, "apps/dashboard"),
  publicDir: path.resolve(rootDir, "public"),
  resolve: {
    alias: {
      "@client": path.resolve(rootDir, "apps/dashboard/src"),
      "@": path.resolve(rootDir, "apps/dashboard/src"),
    },
  },
  build: {
    outDir: path.resolve(rootDir, "dist/client"),
    emptyOutDir: mode !== "development",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("lucide-react")) {
              return "vendor-lucide";
            }
            if (
              id.includes("react") ||
              id.includes("react-dom") ||
              id.includes("react-router-dom")
            ) {
              return "vendor-react";
            }
            if (
              id.includes("recharts") ||
              id.includes("d3") ||
              id.includes("victory")
            ) {
              return "vendor-recharts";
            }
            if (id.includes("motion")) {
              return "vendor-motion";
            }
            if (
              id.includes("remark") ||
              id.includes("rehype") ||
              id.includes("micromark") ||
              id.includes("markdown")
            ) {
              return "vendor-markdown";
            }
            if (id.includes("@base-ui")) {
              return "vendor-base-ui";
            }
            if (
              id.includes("hono") ||
              id.includes("zod") ||
              id.includes("jsonrepair")
            ) {
              return "vendor-utils";
            }
            return "vendor";
          }
        },
      },
    },
  },
}));
