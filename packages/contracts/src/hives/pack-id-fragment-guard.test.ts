import { describe, expect, it } from "vitest";

/** Building pack ids via `].join("")` in application code bypasses pack-backed allowlists (D-053). */
const FRAGMENT_JOIN_PATTERN = /\[[\s\S]*?\]\s*\.join\s*\(\s*["'`]["'`]\s*\)/;

function isExcludedPath(relative: string): boolean {
  const normalized = relative.replaceAll("\\", "/");
  if (normalized.startsWith("packs/")) return true;
  if (normalized.startsWith("eval/")) return true;
  if (normalized === "packages/contracts/src/hives/pack-id-fragment-guard.test.ts") return true;
  if (normalized.includes("/node_modules/")) return true;
  if (normalized.includes("/.next/")) return true;
  if (normalized.includes("/dist/")) return true;
  if (normalized.includes("/.turbo/")) return true;
  if (normalized.includes("/archive/")) return true;
  return false;
}

const SOURCE_TEXT = {
  ...import.meta.glob("../../../../apps/**/*.{ts,tsx,js,mjs,cjs}", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
  ...import.meta.glob("../../../../packages/**/*.{ts,tsx,js,mjs,cjs}", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
} as Record<string, string>;

function relativePathFromGlobKey(key: string): string {
  const normalized = key.replaceAll("\\", "/");
  return normalized.replace(/^(\.\.\/)+/, "");
}

describe("pack id fragment join guard (D-053)", () => {
  it(
    "does not build pack ids from split string fragments outside packs/ and eval/",
    () => {
      const offenders: string[] = [];
      for (const [key, text] of Object.entries(SOURCE_TEXT)) {
        if (typeof text !== "string") continue;
        const relative = relativePathFromGlobKey(key);
        if (isExcludedPath(relative)) continue;
        if (FRAGMENT_JOIN_PATTERN.test(text)) offenders.push(relative);
      }
      expect(offenders).toEqual([]);
    },
    30_000,
  );
});