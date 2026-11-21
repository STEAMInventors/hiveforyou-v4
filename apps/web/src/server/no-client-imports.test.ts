import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(__dirname, "..");

/** Offenders on `main` before this hotfix (value imports from `"use client"` modules). */
export const MAIN_BRANCH_CLIENT_IMPORT_OFFENDERS = [
  "src/server/hives/hive-workspace-frame.tsx → WorkspaceShell from @/components/workspace/WorkspaceShell",
  "lib/reports-client.ts → parseApiJson from ./hives-client (use client)",
  "lib/study-preparation-client.ts → parseApiJson from ./hives-client (use client)",
  "lib/source-documents-client.ts → parseApiJson from ./hives-client (use client)",
  "lib/hives/ClientsHomeLayoutBridge.tsx → ClientsHomeProvider from ./clients-home-context (use client)",
];

type ParsedImport = {
  readonly specifier: string;
  readonly names: readonly string[];
  readonly isTypeOnly: boolean;
};

function listFilesRecursively(dir: string, match: (relative: string) => boolean): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...listFilesRecursively(full, match));
      continue;
    }
    const relative = path.relative(SRC_ROOT, full).replaceAll("\\", "/");
    if (match(relative)) results.push(full);
  }
  return results;
}

function guardedServerFiles(): string[] {
  const fromDir = (segment: string) =>
    listFilesRecursively(path.join(SRC_ROOT, segment), (relative) => /\.(ts|tsx)$/.test(relative));
  const appServer = listFilesRecursively(path.join(SRC_ROOT, "app"), (relative) =>
    /\/(page|layout|route|loading)\.tsx$/.test(relative),
  );
  return [...fromDir("server"), ...fromDir("lib"), ...appServer];
}

function isUseClientModule(filePath: string): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
  } catch {
    return false;
  }
  const text = readFileSync(filePath, "utf8");
  const first = text.trimStart().split(/\r?\n/, 1)[0]?.trim();
  return first === '"use client";' || first === "'use client';";
}

function resolveModule(fromFile: string, specifier: string): string | null {
  let base: string | null = null;
  if (specifier.startsWith("@/")) {
    base = path.join(SRC_ROOT, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  }
  if (!base) return null;
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  try {
    if (existsSync(base) && statSync(base).isFile()) candidates.push(base);
  } catch {
    /* ignore */
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      if (statSync(candidate).isDirectory()) continue;
    } catch {
      continue;
    }
    return candidate;
  }
  return null;
}

function parseImports(source: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const importRe =
    /^\s*import\s+(type\s+)?(?:(\*\s+as\s+(\w+))|(?:([\w$]+)\s*,\s*)?\{([^}]*)\}|([\w$]+))\s+from\s+["']([^"']+)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(source)) !== null) {
    const isTypeOnly = Boolean(match[1]);
    const namespace = match[3];
    const defaultName = match[4] ?? match[6];
    const namedBlock = match[5];
    const specifier = match[7];
    const names: string[] = [];
    if (namespace) names.push(namespace);
    if (defaultName) names.push(defaultName);
    if (namedBlock) {
      for (const part of namedBlock.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const split = trimmed.split(/\s+as\s+/);
        const local = split[1]?.trim() || split[0]?.trim();
        if (!local || local === "type") continue;
        if (trimmed.startsWith("type ")) continue;
        names.push(local);
      }
    }
    imports.push({ specifier, names, isTypeOnly });
  }
  return imports;
}

function findClientValueImportViolations(): string[] {
  const violations: string[] = [];
  const fromAppServer = (file: string) => file.replaceAll("\\", "/").includes("/app/");

  for (const file of guardedServerFiles()) {
    const relative = path.relative(SRC_ROOT, file).replaceAll("\\", "/");
    const source = readFileSync(file, "utf8");
    for (const entry of parseImports(source)) {
      if (entry.isTypeOnly) continue;
      const target = resolveModule(file, entry.specifier);
      if (!target || !isUseClientModule(target)) continue;
      for (const name of entry.names) {
        if (fromAppServer(file) && /^[A-Z]/.test(name)) continue;
        violations.push(`${relative} imports ${name} from ${entry.specifier} (${path.relative(SRC_ROOT, target)})`);
      }
    }
  }
  return violations.sort();
}

describe("no-client-imports guard", () => {
  it("documents offenders that existed on main before the hotfix", () => {
    expect(MAIN_BRANCH_CLIENT_IMPORT_OFFENDERS.length).toBeGreaterThan(0);
  });

  it(
    "has no forbidden value imports from use client modules",
    () => {
      const violations = findClientValueImportViolations();
      expect(violations).toEqual([]);
    },
    60_000,
  );
});