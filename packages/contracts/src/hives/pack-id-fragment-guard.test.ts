import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../../..");

const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "dist", ".turbo", "archive"]);

/** Building pack ids via `].join("")` in application code bypasses pack-backed allowlists (D-053). */
const FRAGMENT_JOIN_PATTERN = /\[[\s\S]*?\]\s*\.join\s*\(\s*["'`]["'`]\s*\)/;

function isExcludedPath(relative: string): boolean {
  const normalized = relative.replaceAll("\\", "/");
  if (normalized.startsWith("packs/")) return true;
  if (normalized.startsWith("eval/")) return true;
  if (normalized === "packages/contracts/src/hives/pack-id-fragment-guard.test.ts") return true;
  return false;
}

function listSourceFiles(dir: string, bucket: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry)) continue;
      results.push(...listSourceFiles(full, `${bucket}/${entry}`));
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) continue;
    const relative = `${bucket}/${entry}`.replace(/^\//, "");
    if (isExcludedPath(relative)) continue;
    results.push(full);
  }
  return results;
}

describe("pack id fragment join guard (D-053)", () => {
  it("does not build pack ids from split string fragments outside packs/ and eval/", () => {
    const offenders: string[] = [];
    for (const scanRoot of [path.join(ROOT, "apps"), path.join(ROOT, "packages")]) {
      if (!existsSync(scanRoot)) continue;
      const bucket = path.relative(ROOT, scanRoot).replaceAll("\\", "/");
      for (const file of listSourceFiles(scanRoot, bucket)) {
        const relative = path.relative(ROOT, file).replaceAll("\\", "/");
        if (isExcludedPath(relative)) continue;
        const text = readFileSync(file, "utf8");
        if (FRAGMENT_JOIN_PATTERN.test(text)) {
          offenders.push(relative);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});