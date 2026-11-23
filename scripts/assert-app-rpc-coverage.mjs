#!/usr/bin/env node
/**
 * QF-1a: ensure rpc_smoke_check.sql documents every app/edge RPC name.
 * Also records `name: "rpc"` literals in files that dispatch with `.rpc(value.name)`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokePath = path.join(root, "supabase/tests/database/rpc_smoke_check.sql");

const RPC_PATTERNS = [
  /\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g,
  /\.schema\(\s*["']hive["']\s*\)\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g,
  /(?:await\s+)?rpc\(\s*[^,]+,\s*["']([a-z_][a-z0-9_]*)["']/g,
  /rpcPersist\(\s*[^,]+,\s*["']([a-z_][a-z0-9_]*)["']/g,
  /invokeRpc\(\s*[^,]+,\s*["']([a-z_][a-z0-9_]*)["']/g,
];
const IGNORE = new Set(["fn"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** @type {Set<string>} */
const fromCode = new Set();
for (const base of ["apps/web", "supabase/functions"]) {
  const dir = path.join(root, base);
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8");
    for (const re of RPC_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (!IGNORE.has(m[1])) fromCode.add(m[1]);
      }
    }
    if (/\.rpc\(\s*[A-Za-z_][A-Za-z0-9_]*\.name\b/.test(text)) {
      const nameRe = /\bname:\s*["']([a-z_][a-z0-9_]*)["']/g;
      let named;
      while ((named = nameRe.exec(text)) !== null) {
        if (!IGNORE.has(named[1])) fromCode.add(named[1]);
      }
    }
  }
}

const smokeSql = readFileSync(smokePath, "utf8");
const headerMatch = smokeSql.match(
  /--\s*APP_RPC_COVERAGE_BEGIN\s*([\s\S]*?)\s*--\s*APP_RPC_COVERAGE_END/,
);
if (!headerMatch) {
  console.error(
    "rpc_smoke_check.sql must contain APP_RPC_COVERAGE_BEGIN / APP_RPC_COVERAGE_END listing every RPC.",
  );
  process.exit(1);
}

const fromHeader = new Set(
  headerMatch[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*--\s*-\s*/, "").replace(/^\s*-\s*/, "").trim())
    .filter((l) => l && /^[a-z_][a-z0-9_]*$/.test(l)),
);

const missingInSmoke = [...fromCode].sort().filter((n) => !fromHeader.has(n));
const extraInHeader = [...fromHeader].sort().filter((n) => !fromCode.has(n));

if (missingInSmoke.length || extraInHeader.length) {
  if (missingInSmoke.length) {
    console.error("App/edge RPCs missing from rpc_smoke_check.sql header:");
    for (const n of missingInSmoke) console.error(`  - ${n}`);
  }
  if (extraInHeader.length) {
    console.error("rpc_smoke_check.sql header lists RPCs not found in app/edge sources:");
    for (const n of extraInHeader) console.error(`  - ${n}`);
  }
  process.exit(1);
}

console.log(`RPC coverage OK: ${fromHeader.size} names match apps/web and supabase/functions.`);