import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { type Pack, parsePackMarkdown } from "@hiveforyou/contracts";

import type { PackIndexEntry } from "@hiveforyou/contracts";

export type { PackIndexEntry };

export type PackIndexLoadResult = {
  readonly entries: PackIndexEntry[];
  /** When set, pack-backed prompts must not run for this attempt. */
  readonly skipped?: string;
  /** Per-file parse or read issues (pack loading still continues). */
  readonly fileWarnings?: readonly string[];
};

/** Archive file name for a pinned pack version (under `packs/archive/`). */
export function packArchiveFileName(packId: string, version: number): string {
  return `HiveForYou-Pack-${packId}.v${version}.md`;
}

/** Resolve the repo `packs/` directory from Vercel trace layout or local monorepo checkout. */
export function resolvePacksRoot(cwd: string = process.cwd()): string | null {
  for (const candidate of [
    path.join(cwd, "packs"),
    path.join(cwd, "../packs"),
    path.join(cwd, "../../packs"),
    path.join(cwd, "../../../packs"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function parsePackFile(
  filePath: string,
  fileName: string,
  fileWarnings: string[],
): Pack | null {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    fileWarnings.push(`pack_file_unreadable:${fileName}`);
    return null;
  }
  const parsed = parsePackMarkdown(text);
  if (!parsed.ok) {
    fileWarnings.push(`pack_file_parse_failed:${fileName}`);
    return null;
  }
  return parsed.value;
}

/** Active packs only: top-level `packs/*.md` (not `packs/archive/`). One entry per id at highest version. */
function dedupeEntriesByLatestVersion(entries: PackIndexEntry[]): PackIndexEntry[] {
  const byId = new Map<string, PackIndexEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (!existing || entry.pack.meta.version > existing.pack.meta.version) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()];
}

export function loadPackEntries(cwd: string = process.cwd()): PackIndexLoadResult {
  const root = resolvePacksRoot(cwd);
  if (!root) {
    return { entries: [], skipped: "pack_directory_missing" };
  }
  let fileNames: string[];
  try {
    fileNames = readdirSync(root);
  } catch {
    return { entries: [], skipped: "pack_index_unreadable" };
  }
  const entries: PackIndexEntry[] = [];
  const fileWarnings: string[] = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".md")) continue;
    const filePath = path.join(root, fileName);
    const pack = parsePackFile(filePath, fileName, fileWarnings);
    if (!pack) continue;
    entries.push({ id: pack.meta.pack, fileName, pack });
  }
  const deduped = dedupeEntriesByLatestVersion(entries);
  return fileWarnings.length > 0 ? { entries: deduped, fileWarnings } : { entries: deduped };
}

export function loadPackById(id: string, version: number, cwd: string = process.cwd()): Pack | null {
  const root = resolvePacksRoot(cwd);
  if (!root) return null;

  const { entries } = loadPackEntries(cwd);
  const active = entries.find((row) => row.id === id && row.pack.meta.version === version);
  if (active) return active.pack;

  const archiveName = packArchiveFileName(id, version);
  const archivePath = path.join(root, "archive", archiveName);
  if (!existsSync(archivePath)) return null;
  const warnings: string[] = [];
  const pack = parsePackFile(archivePath, archiveName, warnings);
  if (!pack || pack.meta.pack !== id || pack.meta.version !== version) return null;
  return pack;
}
