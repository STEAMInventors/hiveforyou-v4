import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

import {
  loadPackById,
  loadPackEntries,
  logPinnedPackNotFound,
  packArchiveFileName,
  resolvePacksRoot,
} from "./pack-loader";
import * as logger from "@/server/observability/logger";

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

  it("keeps only the highest version per pack id for selection", () => {
    const root = mkdtempSync(join(tmpdir(), "hive-pack-loader-"));
    const packsDir = join(root, "packs");
    try {
      mkdirSync(packsDir);
      const base = readFixtureAsText();
      writeFileSync(join(packsDir, "widget-v1.md"), base.replace("version: 2", "version: 1"));
      writeFileSync(join(packsDir, "widget-v2.md"), base);
      const result = loadPackEntries(root);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.pack.meta.version).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads a pinned version from packs/archive when absent from the active index", () => {
    const root = mkdtempSync(join(tmpdir(), "hive-pack-loader-"));
    const packsDir = join(root, "packs");
    const archiveDir = join(packsDir, "archive");
    try {
      mkdirSync(archiveDir, { recursive: true });
      const base = readFixtureAsText();
      writeFileSync(join(packsDir, "widget-review.md"), base);
      writeFileSync(
        join(archiveDir, packArchiveFileName("widget-review", 1)),
        base.replace("version: 2", "version: 1"),
      );
      expect(loadPackById("widget-review", 2, root)?.meta.version).toBe(2);
      expect(loadPackById("widget-review", 1, root)?.meta.version).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null for a missing pinned version without falling back to another version", () => {
    const root = mkdtempSync(join(tmpdir(), "hive-pack-loader-"));
    const packsDir = join(root, "packs");
    try {
      mkdirSync(packsDir);
      cpSync(FIXTURE_PACK, join(packsDir, "widget-review.md"));
      expect(loadPackById("widget-review", 99, root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("emits WARN when logPinnedPackNotFound is called with correlationId", () => {
    const spy = vi.spyOn(logger, "emitStructuredEvent").mockImplementation(() => {});
    logPinnedPackNotFound({
      correlationId: "corr-test",
      packId: "widget-review",
      packVersion: 3,
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "WARN",
        diagnosticReason: "pack_pinned_version_not_found",
        diagnosticField: "widget-review@3",
      }),
    );
    spy.mockRestore();
  });
});

function readFixtureAsText(): string {
  return readFileSync(FIXTURE_PACK, "utf8");
}
