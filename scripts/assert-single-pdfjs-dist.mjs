#!/usr/bin/env node
/**
 * Fails when npm resolves more than one distinct pdfjs-dist version (react-pdf must own the sole copy).
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let json;
try {
  json = execSync("npm ls pdfjs-dist --all --json", {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
  if (!stdout.trim()) {
    console.error("assert-single-pdfjs-dist: npm ls pdfjs-dist failed with no output");
    process.exit(1);
  }
  json = stdout;
}

/** @type {unknown} */
const tree = JSON.parse(json);

const versions = new Set();

/**
 * npm ls --json keys dependency entries by package name; nodes carry `version`, not `name`.
 * @param {unknown} deps
 */
function walkDeps(deps) {
  if (!deps || typeof deps !== "object") return;
  for (const [depName, dep] of Object.entries(deps)) {
    if (!dep || typeof dep !== "object") continue;
    const version = "version" in dep && typeof dep.version === "string" ? dep.version : null;
    if (depName === "pdfjs-dist" && version) versions.add(version);
    if ("dependencies" in dep && dep.dependencies && typeof dep.dependencies === "object") {
      walkDeps(dep.dependencies);
    }
  }
}

if (tree && typeof tree === "object" && "dependencies" in tree) {
  walkDeps(tree.dependencies);
}

if (versions.size === 0) {
  console.error("assert-single-pdfjs-dist: pdfjs-dist not found in dependency tree");
  process.exit(1);
}

if (versions.size > 1) {
  console.error(
    `assert-single-pdfjs-dist: expected one pdfjs-dist version, found: ${[...versions].sort().join(", ")}`,
  );
  process.exit(1);
}
