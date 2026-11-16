#!/usr/bin/env node
/**
 * Run pgTAP (*.test.sql) the same way as HiveForYou-database-tests.yml:
 * prepend pg_fixture_helpers.sql to each file, then `supabase test db`.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(root, "supabase", "tests", "database");
const helper = path.join(testDir, "pg_fixture_helpers.sql");
const helperSql = readFileSync(helper, "utf8");

const tests = readdirSync(testDir)
  .filter((name) => name.endsWith(".test.sql"))
  .sort();

if (tests.length === 0) {
  console.error(`No *.test.sql under ${testDir}`);
  process.exit(1);
}

const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "hiveforyou-pgtap-"));
const merged = [];

for (const name of tests) {
  const body = readFileSync(path.join(testDir, name), "utf8");
  const out = path.join(tmpRoot, name);
  writeFileSync(out, `${helperSql}\n${body}`, "utf8");
  merged.push(out);
}

console.log(`Merged ${tests.length} test file(s) with pg_fixture_helpers.sql`);
execFileSync("supabase", ["test", "db", ...merged], { stdio: "inherit", cwd: root });