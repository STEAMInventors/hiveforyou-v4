#!/usr/bin/env node
/** One-time helper: copy OFL woff2 + LICENSE from @fontsource into apps/web/src/app/fonts */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "apps", "web", "src", "app", "fonts");
const nm = path.join(root, "node_modules", "@fontsource");

const copies = [
  ["outfit", "outfit-latin-400-normal.woff2"],
  ["outfit", "outfit-latin-500-normal.woff2"],
  ["outfit", "outfit-latin-600-normal.woff2"],
  ["dm-sans", "dm-sans-latin-400-normal.woff2"],
  ["dm-sans", "dm-sans-latin-500-normal.woff2"],
  ["dm-sans", "dm-sans-latin-600-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-400-normal.woff2"],
  ["jetbrains-mono", "jetbrains-mono-latin-500-normal.woff2"],
  ["source-serif-4", "source-serif-4-latin-400-normal.woff2"],
  ["source-serif-4", "source-serif-4-latin-400-italic.woff2"],
  ["source-serif-4", "source-serif-4-latin-500-normal.woff2"],
  ["source-serif-4", "source-serif-4-latin-500-italic.woff2"],
];

mkdirSync(dest, { recursive: true });

for (const [pkg, file] of copies) {
  const src = path.join(nm, pkg, "files", file);
  if (!existsSync(src)) {
    console.error(`Missing ${src} — run: npm install --no-save @fontsource/${pkg}@5`);
    process.exit(1);
  }
  copyFileSync(src, path.join(dest, file));
}

for (const pkg of ["outfit", "dm-sans", "jetbrains-mono", "source-serif-4"]) {
  const license = readFileSync(path.join(nm, pkg, "LICENSE"), "utf8");
  writeFileSync(path.join(dest, `OFL-${pkg}.txt`), license, "utf8");
}

console.log(`Copied ${copies.length} woff2 file(s) and licenses to ${dest}`);