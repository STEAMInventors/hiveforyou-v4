import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { loadPackEntries, resolvePacksRoot } from "./pack-loader";

const FIXTURE_PACK = resolve(
  import.meta.dirname,
  "../../../../../packages/contracts/src/testing/fixtures/widget-review-pack.md",
);

describe("pack-loader", () => {
  it("returns skip when packs directory is absent", () => {
    const empty = mkdtempSync(join(tmpdir(), "hive-pack-loader-"));
    try {
      expect(resolvePacksRoot(empty)).toBeNull();
      const result = loadPackEntries(empty);
      expect(result.entries).toEqual([]);
      expect(result.skipped).toBe("pack_directory_missing");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("skips invalid pack files and loads valid ones from the same folder", () => {
    const root = mkdtempSync(join(tmpdir(), "hive-pack-loader-"));
    const packsDir = join(root, "packs");
    try {
      mkdirSync(packsDir);
      cpSync(FIXTURE_PACK, join(packsDir, "widget-review.md"));
      writeFileSync(join(packsDir, "broken.md"), "---\npack: broken\nversion: 1\n---\n\n## Checks\n| Id | Check |\n| A1 | dup |\n| A1 | dup |\n");
      const result = loadPackEntries(root);
      expect(result.skipped).toBeUndefined();
      expect(result.entries).toHaveLength(1);
      expect(result.fileWarnings).toContain("pack_file_parse_failed:broken.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
