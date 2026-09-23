import { readFileSync, writeFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';

const mode = process.argv[2];
const PKG = 'package.json';
const BAK = 'package.json.prepack-bak';
const PROMOTABLE = ['main', 'module', 'types', 'exports', 'bin', 'browser'];

if (mode === 'promote') {
  copyFileSync(PKG, BAK);
  const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
  const fields = pkg.publishConfig ?? {};
  for (const field of PROMOTABLE) {
    if (fields[field] !== undefined) {
      pkg[field] = fields[field];
      delete pkg.publishConfig[field]; // Remove to prevent npm warnings
    }
  }
  
  writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
} else if (mode === 'restore') {
  if (existsSync(BAK)) {
    copyFileSync(BAK, PKG);
    rmSync(BAK);
  }
} else {
  console.error('Usage: swap-publish-exports.mjs <promote|restore>');
  process.exit(1);
}
