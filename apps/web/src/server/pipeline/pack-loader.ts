import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { type Pack, parsePackMarkdown } from "@hiveforyou/contracts";

import type { PackIndexEntry } from "@hiveforyou/contracts";

export type { PackIndexEntry };

function packsRoot(cwd: string = process.cwd()): string {
  for (const candidate of [path.join(cwd, "packs"), path.join(cwd, "../../packs"), path.join(cwd, "../packs")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("pack_directory_missing");
}

export function loadPackEntries(cwd: string = process.cwd()): PackIndexEntry[] {
  const root = packsRoot(cwd);
  const entries: PackIndexEntry[] = [];
  for (const fileName of readdirSync(root)) {
    if (!fileName.endsWith(".md")) continue;
    const text = readFileSync(path.join(root, fileName), "utf8");
    const parsed = parsePackMarkdown(text);
    if (!parsed.ok) continue;
    const pack = parsed.value;
    entries.push({ id: pack.meta.pack, fileName, pack });
  }
  return entries;
}

export function loadPackById(id: string, version: number, cwd: string = process.cwd()): Pack | null {
  const entry = loadPackEntries(cwd).find((row) => row.id === id && row.pack.meta.version === version);
  return entry?.pack ?? null;
}
