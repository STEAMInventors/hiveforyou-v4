/**
 * Next.js middleware loads `@hiveforyou/contracts` through the correlation id check.
 * That barrel must not value-import a Node built-in. `import type` is erased and is not a runtime edge.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(import.meta.dirname, "..");
const REPO_ROOT = join(WEB_ROOT, "..", "..");
const CONTRACTS_ROOT = join(REPO_ROOT, "packages", "contracts");
const WEB_SRC = join(WEB_ROOT, "src");

const NODE_BUILTINS = new Set([
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "crypto",
  "dgram",
  "dns",
  "fs",
  "fs/promises",
  "http",
  "https",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "readline",
  "stream",
  "tls",
  "url",
  "util",
  "vm",
  "worker_threads",
  "zlib",
]);

type PackageExports = Record<string, string>;

const contractExports = (
  JSON.parse(readFileSync(join(CONTRACTS_ROOT, "package.json"), "utf8")) as { exports: PackageExports }
).exports;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function isTypeOnly(clause: string): boolean {
  const body = clause.trim();
  if (body.startsWith("type ") || body.startsWith("type{")) return true;
  const braceStart = body.indexOf("{");
  const braceEnd = body.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    const outside = `${body.slice(0, braceStart)} ${body.slice(braceEnd + 1)}`.trim();
    if (outside.length > 0 && !outside.startsWith("type")) return false;
    const parts = body
      .slice(braceStart + 1, braceEnd)
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return parts.length > 0 && parts.every((part) => part.startsWith("type "));
  }
  return false;
}

function runtimeSpecifiers(source: string): string[] {
  const clean = stripComments(source);
  const specifiers: string[] = [];
  const fromImport = /(?:^|\n)\s*(?:import|export)\s+([\s\S]*?)\sfrom\s*["']([^"']+)["']/g;
  for (const match of clean.matchAll(fromImport)) {
    if (!isTypeOnly(match[1] ?? "")) specifiers.push(match[2] ?? "");
  }
  const sideEffect = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  for (const match of clean.matchAll(sideEffect)) specifiers.push(match[1] ?? "");
  return specifiers.filter((specifier) => specifier.length > 0);
}

function resolveExisting(base: string): string | null {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function isNodeSpecifier(specifier: string): boolean {
  return specifier.startsWith("node:") || NODE_BUILTINS.has(specifier);
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (isNodeSpecifier(specifier) || specifier.startsWith("node:")) return null;
  if (specifier.startsWith(".")) return resolveExisting(resolve(dirname(fromFile), specifier));
  if (specifier.startsWith("@/")) return resolveExisting(join(WEB_SRC, specifier.slice(2)));
  if (specifier === "server-only") return resolveExisting(join(WEB_SRC, "lib", "server", "server-only.ts"));
  if (specifier === "@hiveforyou/contracts" || specifier.startsWith("@hiveforyou/contracts/")) {
    const key = specifier === "@hiveforyou/contracts" ? "." : `.${specifier.slice("@hiveforyou/contracts".length)}`;
    const target = contractExports[key];
    return typeof target === "string" ? resolveExisting(resolve(CONTRACTS_ROOT, target)) : null;
  }
  return null;
}

function middlewareGraph(): { hits: string[]; files: string[] } {
  const middleware = join(WEB_SRC, "middleware.ts");
  const hits: string[] = [];
  const seen = new Set<string>();
  const queue: { file: string; chain: string[] }[] = [{ file: middleware, chain: ["apps/web/src/middleware.ts"] }];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || seen.has(current.file)) continue;
    seen.add(current.file);
    for (const specifier of runtimeSpecifiers(readFileSync(current.file, "utf8"))) {
      if (isNodeSpecifier(specifier)) {
        hits.push(`${current.chain.join(" -> ")} -> ${specifier}`);
        continue;
      }
      const next = resolveSpecifier(current.file, specifier);
      if (!next || seen.has(next)) continue;
      queue.push({ file: next, chain: [...current.chain, relative(REPO_ROOT, next).replaceAll("\\", "/")] });
    }
  }
  return { hits, files: [...seen] };
}

describe("middleware module graph", () => {
  const graph = middlewareGraph();

  it("does not value-import a Node built-in", () => {
    expect(graph.hits).toEqual([]);
  });

  it("names the investigation prompt without loading the investigation engine", () => {
    const files = graph.files.map((file) => file.replaceAll("\\", "/"));
    expect(files.some((file) => file.endsWith("/planner-wire-contracts.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("/domain-investigation-prompt.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("/domain-investigation-agent.ts"))).toBe(false);
    expect(files.some((file) => file.endsWith("/domain-pack-compiler.ts"))).toBe(false);
  });
});
