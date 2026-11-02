import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await mkdir(path.join(root, "dist/styles"), { recursive: true });
await copyFile(
  path.join(root, "src/styles/tokens.css"),
  path.join(root, "dist/styles/tokens.css"),
);
