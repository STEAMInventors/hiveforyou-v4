#!/usr/bin/env node
/**
 * Fails when Next output file tracing did not bundle repo-root packs/*.md into serverless routes
 * that call the pack loader (directly or via report write after `processReportRunSafely`).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "apps/web/.next/server");

/** Route path segments (under `app/`) that must trace packs/*.md — keep in sync with next.config.ts */
const ROUTE_PATH_MARKERS = [
  "hives/[hiveId]/study/page",
  "hives/[hiveId]/reports/page",
  "hives/[hiveId]/documents/page",
  "hives/page",
  "api/internal/workflow/route",
  "api/internal/workflow-recovery/route",
  "api/v1/hives/[hiveId]/reports/route",
  "api/v1/hives/[hiveId]/study-preparation/rebuild/route",
  "api/v1/hives/[hiveId]/study-preparation/route",
];

if (!existsSync(serverDir)) {
  console.error("assert-packs-traced: run `npm run build` first (missing apps/web/.next/server)");
  process.exit(1);
}

/** @param {string} dir @param {string[]} acc */
function collectNftJson(dir, acc) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectNftJson(full, acc);
      continue;
    }
    if (name.endsWith(".nft.json")) acc.push(full);
  }
}

/** @type {string[]} */
const nftFiles = [];
collectNftJson(serverDir, nftFiles);

const packPattern = /(^|[\\/])packs[\\/].+\.md$/i;

/** @param {string} nftPath */
function routeMarkerForNft(nftPath) {
  const normalized = nftPath.split(path.sep).join("/");
  const appIdx = normalized.indexOf("/app/");
  if (appIdx < 0) return null;
  const afterApp = normalized.slice(appIdx + "/app/".length);
  return ROUTE_PATH_MARKERS.find((marker) => afterApp.startsWith(`${marker}.`)) ?? null;
}

/** @type {Map<string, string[]>} */
const byRoute = new Map();
for (const marker of ROUTE_PATH_MARKERS) byRoute.set(marker, []);

for (const nftPath of nftFiles) {
  const marker = routeMarkerForNft(nftPath);
  if (!marker) continue;
  byRoute.get(marker)?.push(nftPath);
}

let failed = false;

for (const marker of ROUTE_PATH_MARKERS) {
  const candidates = byRoute.get(marker) ?? [];
  if (candidates.length === 0) {
    console.error(`assert-packs-traced: no .nft.json found for app/${marker}`);
    failed = true;
    continue;
  }

  let found = false;
  for (const nftPath of candidates) {
    /** @type {{ files?: string[] }} */
    const manifest = JSON.parse(readFileSync(nftPath, "utf8"));
    for (const traced of manifest.files ?? []) {
      if (packPattern.test(traced)) {
        found = true;
        console.log(`assert-packs-traced: ok app/${marker} (${traced} in ${path.relative(root, nftPath)})`);
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    console.error(
      `assert-packs-traced: no packs/*.md in trace for app/${marker}; add outputFileTracingIncludes in next.config.ts`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);
