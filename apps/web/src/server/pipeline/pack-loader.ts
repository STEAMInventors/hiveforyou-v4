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
    let text: string;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      fileWarnings.push(`pack_file_unreadable:${fileName}`);
      continue;
    }
    const parsed = parsePackMarkdown(text);
    if (!parsed.ok) {
      fileWarnings.push(`pack_file_parse_failed:${fileName}`);
      continue;
    }
    const pack = parsed.value;
    entries.push({ id: pack.meta.pack, fileName, pack });
  }
  return fileWarnings.length > 0 ? { entries, fileWarnings } : { entries };
}

export function loadPackById(id: string, version: number, cwd: string = process.cwd()): Pack | null {
  const { entries } = loadPackEntries(cwd);
  const entry = entries.find((row) => row.id === id && row.pack.meta.version === version);
  return entry?.pack ?? null;
}
