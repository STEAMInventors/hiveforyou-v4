#!/usr/bin/env node
/**
 * Fails when Next output file tracing did not bundle repo-root packs/*.md and assistant prompt files
 * into serverless routes that call the pack loader or assistant prompt loader.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(root, "apps/web/.next/server");

/** Route path segments (under `app/`) that must trace packs and assistant prompt — keep in sync with pack/prompt loaders */
const ROUTE_PATH_MARKERS = [
  "hives/[hiveId]/study/page",
  "hives/[hiveId]/reports/page",
  "hives/[hiveId]/documents/page",
  "hives/[hiveId]/findings/page",
  "hives/[hiveId]/audit/page",
  "hives/[hiveId]/board/page",
  "hives/new-client/page",
  "hives/page",
  "api/internal/workflow/route",
  "api/internal/workflow-recovery/route",
  "api/v1/hives/[hiveId]/messages/route",
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

const packPattern = /(^|[\\/])packs([\\/]archive)?[\\/].+\.md$/i;
const assistantPromptPattern = /(^|[\\/])prompts[\\/]hive-assistant-reply[\\/]v1\.md$/i;

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

/** @param {string[]} files */
function traceHasPack(files) {
  return files.some((traced) => packPattern.test(traced));
}

/** @param {string[]} files */
function traceHasAssistantPrompt(files) {
  return files.some((traced) => assistantPromptPattern.test(traced));
}

/** @param {string} marker @param {string[]} nftPaths */
function assertRouteTraced(marker, nftPaths) {
  if (nftPaths.length === 0) {
    console.error(`assert-packs-traced: no .nft.json found for app/${marker}`);
    return false;
  }

  let packFound = false;
  let promptFound = false;
  let sampleNft = nftPaths[0];

  for (const nftPath of nftPaths) {
    /** @type {{ files?: string[] }} */
    const manifest = JSON.parse(readFileSync(nftPath, "utf8"));
    const files = manifest.files ?? [];
    if (!packFound && traceHasPack(files)) {
      packFound = true;
      sampleNft = nftPath;
    }
    if (!promptFound && traceHasAssistantPrompt(files)) {
      promptFound = true;
    }
    if (packFound && promptFound) break;
  }

  if (!packFound) {
    console.error(
      `assert-packs-traced: no packs/*.md in trace for app/${marker}; add outputFileTracingIncludes in next.config.ts`,
    );
    return false;
  }
  if (!promptFound) {
    console.error(
      `assert-packs-traced: prompts/hive-assistant-reply/v1.md missing in trace for app/${marker}`,
    );
    return false;
  }

  console.log(`assert-packs-traced: ok app/${marker} (pack + assistant prompt in ${path.relative(root, sampleNft)})`);
  return true;
}

let failed = false;
for (const marker of ROUTE_PATH_MARKERS) {
  const candidates = byRoute.get(marker) ?? [];
  if (!assertRouteTraced(marker, candidates)) failed = true;
}

if (failed) process.exit(1);