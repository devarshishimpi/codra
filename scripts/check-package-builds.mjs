import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");

const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const buildPackages = rootPkg.scripts?.["build:packages"] ?? "";

const errors = [];
const checked = [];

for (const name of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, name);
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) continue;

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  if (pkg.private) continue;
  if (!pkg.scripts?.build) continue;

  const id = pkg.name ?? name;
  checked.push(id);

  // build:packages invokes each workspace via `npm run build -w <name>`
  const isCovered =
    new RegExp(`-w\\s+${id}(?:\\s|$)`).test(buildPackages) ||
    new RegExp(`-w\\s+${name}(?:\\s|$)`).test(buildPackages);
  if (!isCovered) {
    errors.push(
      `${id}: has a "build" script but is missing from root "build:packages". ` +
        `CI lints every packages/*/ with publint, so its dist/ is never built on a fresh runner. ` +
        `Add "npm run build -w ${id}" to "build:packages" in package.json.`,
    );
  }
}

if (errors.length) {
  console.error("Package build coverage check failed:\n");
  for (const e of errors) console.error("  - " + e);
  console.error("\nChecked: " + checked.join(", "));
  process.exit(1);
}

console.log(
  `Package build coverage check passed: build:packages covers all publishable packages (${checked.join(", ")}).`,
);
