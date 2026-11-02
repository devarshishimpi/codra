import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");

const errors = [];

for (const name of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, name);
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) continue;

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const id = pkg.name ?? name;
  if (pkg.private) continue;

  const exp = pkg.exports;
  const pubExp = pkg.publishConfig?.exports;

  if (!exp) {
    errors.push(`${id}: missing top-level "exports".`);
    continue;
  }
  if (!pubExp) {
    errors.push(
      `${id}: missing "publishConfig.exports" (the compiled/dist surface).`,
    );
    continue;
  }

  const srcKeys = Object.keys(exp).sort();
  const distKeys = Object.keys(pubExp).sort();
  if (JSON.stringify(srcKeys) !== JSON.stringify(distKeys)) {
    const onlySrc = srcKeys.filter((k) => !distKeys.includes(k));
    const onlyDist = distKeys.filter((k) => !srcKeys.includes(k));
    errors.push(
      `${id}: exports keys drift between source and publishConfig.` +
        (onlySrc.length ? ` Only in exports: ${onlySrc.join(", ")}.` : "") +
        (onlyDist.length
          ? ` Only in publishConfig.exports: ${onlyDist.join(", ")}.`
          : ""),
    );
  }

  for (const [key, target] of Object.entries(exp)) {
    if (typeof target !== "string") {
      errors.push(
        `${id}: source export "${key}" must be a string path to a .ts/.tsx source file.`,
      );
      continue;
    }
    if (target.includes("*")) continue;
    if (!existsSync(join(pkgDir, target))) {
      errors.push(
        `${id}: export "${key}" points at "${target}" which does not exist.`,
      );
    }
  }

  if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) {
    errors.push(
      `${id}: "files" must include "dist" so the compiled output is published.`,
    );
  }
  if (pkg.publishConfig?.access !== "public") {
    errors.push(`${id}: "publishConfig.access" must be "public".`);
  }
}

if (errors.length) {
  console.error("Package export check failed:\n");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\nFix the exports maps in the offending packages/*/package.json.",
  );
  process.exit(1);
}

console.log(
  "Package export check passed: all publishable @codraoss/* packages have consistent, resolvable exports.",
);
