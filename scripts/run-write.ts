// Runs hive-write/1 over canonical.json and extract outputs in one run folder, then scores with scripts/eval.ts.
// Usage: npm run write -- <corpus-id> <run-folder> "<audience>" "<intent>"
// Needs PLANNER_BASE_URL and PLANNER_SERVICE_TOKEN, plus <run-folder>/canonical.json and extract/*.json.
// Writes <run-folder>/view.json (hive.study-view/1), view.html (static review), and write-stats.json.

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  CANONICAL_STUDY_SCHEMA,
  DOC_EXTRACTION_SCHEMA,
  type CanonicalStudy,
  type DocExtraction,
  type StudyView,
} from "@hiveforyou/contracts";

import { factRecordsFromExtractions, writeStudyView, type WriteCallRecord } from "../apps/web/src/server/pipeline/write-runner";
import { loadPlannerServiceConfig } from "../apps/web/src/server/study-preparation/planner-client";
import { loadPromptCatalog } from "../apps/web/src/server/study-preparation/prompt-catalog";

const ROOT = resolve(import.meta.dirname, "..");

function fail(message: string): never {
  console.error(message);
  console.error('Usage: npm run write -- <corpus-id> <run-folder> "<audience>" "<intent>"');
  process.exit(2);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderViewHtml(view: StudyView, audience: string, intent: string): string {
  const parts: string[] = [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8"><title>Study view</title>',
    "<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;line-height:1.5}",
    "h1,h2{margin-top:1.5rem}table{border-collapse:collapse;width:100%;margin:1rem 0}",
    "th,td{border:1px solid #ccc;padding:.4rem .6rem;vertical-align:top;font-size:.9rem}",
    ".meta{color:#555;font-size:.95rem}.fact{font-size:.8rem;color:#444}</style></head><body>",
    "<h1>Study view</h1>",
    `<p class="meta"><strong>Audience:</strong> ${escapeHtml(audience)}</p>`,
    `<p class="meta"><strong>Intent:</strong> ${escapeHtml(intent)}</p>`,
  ];
  if (view.packSections && view.packSections.length > 0) {
    parts.push("<h2>Pack report sections</h2><ol>");
    for (const section of view.packSections) {
      parts.push(`<li><strong>${escapeHtml(`${section.order}. ${section.heading}`)}</strong> — blocks: ${escapeHtml(section.blocks.map((b) => b.name).join(", "))}</li>`);
    }
    parts.push("</ol>");
    for (const section of view.packSections) {
      parts.push(`<h2>${escapeHtml(`${section.order}. ${section.heading}`)}</h2>`);
      for (const block of section.blocks) {
        parts.push(`<h3>${escapeHtml(block.name)}</h3>`);
        if (block.rows.length === 0) {
          parts.push("<p><em>None</em></p>");
          continue;
        }
        parts.push("<table><thead><tr><th>Id</th><th>Summary</th></tr></thead><tbody>");
        for (const row of block.rows) {
          const summary = row.label ?? row.statement ?? row.typeInPlainWords ?? row.id;
          parts.push(`<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(summary ?? "")}</td></tr>`);
        }
        parts.push("</tbody></table>");
      }
    }
  }
  for (const section of view.sections) {
    parts.push(`<h2>${escapeHtml(section.heading)}</h2>`);
    for (const paragraph of section.paragraphs) {
      parts.push("<p>");
      for (const sentence of paragraph.sentences) {
        parts.push(`${escapeHtml(sentence.text)} <span class="fact">[${escapeHtml(sentence.factIds.join(", "))}]</span> `);
      }
      parts.push("</p>");
    }
  }
  for (const block of view.blocks) {
    parts.push(`<h2>${escapeHtml(block.name)}</h2>`);
    if (block.rows.length === 0) {
      parts.push("<p><em>None</em></p>");
      continue;
    }
    parts.push("<table><thead><tr><th>Id</th><th>Summary</th><th>Values</th></tr></thead><tbody>");
    for (const row of block.rows) {
      const summary = row.label ?? row.statement ?? row.typeInPlainWords ?? (row.role ? `Role: ${row.role}` : "");
      const values = row.values
        .map(
          (v) =>
            `${escapeHtml(v.valueAsWritten)} (${escapeHtml(v.factId)}, p.${v.sourceRef.pageNumber})`,
        )
        .join("<br>");
      parts.push(
        `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(summary)}</td><td>${values || "—"}</td></tr>`,
      );
    }
    parts.push("</tbody></table>");
  }
  parts.push("</body></html>");
  return parts.join("\n");
}

const [corpusId, runArg, audienceArg, intentArg] = process.argv.slice(2);
if (!corpusId || !runArg || audienceArg === undefined || intentArg === undefined) fail("Missing arguments.");
const audience = audienceArg.trim();
const intent = intentArg.trim();
if (!audience || !intent) fail("Audience and intent must be non-empty strings.");

const runDir = resolve(runArg);
const canonicalPath = join(runDir, "canonical.json");
const extractDir = join(runDir, "extract");
if (!existsSync(canonicalPath)) fail(`No ${canonicalPath}; run npm run canonicalize first.`);
if (!existsSync(extractDir)) fail(`No extract outputs in ${runDir}; run npm run extract first.`);

const canonical = JSON.parse(readFileSync(canonicalPath, "utf8")) as CanonicalStudy;
if (canonical.schema !== CANONICAL_STUDY_SCHEMA) fail(`canonical.json schema must be ${CANONICAL_STUDY_SCHEMA}`);

const extractions = readdirSync(extractDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => {
    const value = JSON.parse(readFileSync(join(extractDir, name), "utf8")) as DocExtraction;
    if (value?.schema !== DOC_EXTRACTION_SCHEMA) fail(`${name}: schema must be ${DOC_EXTRACTION_SCHEMA}`);
    return value;
  });
if (extractions.length === 0) fail(`No extract outputs in ${extractDir}`);

const correlationId = randomUUID();
const runId = randomUUID();
const plannerConfig = (() => {
  try {
    return loadPlannerServiceConfig(process.env, correlationId);
  } catch {
    return fail("PLANNER_BASE_URL and PLANNER_SERVICE_TOKEN must be set.");
  }
})();
const planner = { getConfig: () => plannerConfig };
const prompt = loadPromptCatalog(ROOT).write;
const facts = factRecordsFromExtractions(extractions);

console.log(
  `Write ${corpusId}: ${facts.length} facts, audience "${audience}", prompt ${prompt.id} ${prompt.digest.slice(0, 19)}`,
);
const started = Date.now();
const result = await writeStudyView({
  planner,
  canonicalStudy: canonical,
  facts,
  reportRole: "CUSTOMER",
  audience,
  intent,
  correlationId,
  runId,
  prompt,
});
const calls: WriteCallRecord[] = result.calls;

const sum = (pick: (c: WriteCallRecord) => number | null) => calls.reduce((n, c) => n + (pick(c) ?? 0), 0);
const inputTokens = sum((c) => c.inputTokens);
const outputTokens = sum((c) => c.outputTokens);
const resolvedModels = [...new Set(calls.flatMap((c) => (c.resolvedModel ? [c.resolvedModel] : [])))];
const stats = {
  schema: "hive.write-run-stats/1",
  corpus: corpusId,
  runAt: new Date().toISOString(),
  wallClockMs: Date.now() - started,
  promptId: prompt.id,
  promptDigest: prompt.digest,
  audience,
  intent,
  facts: facts.length,
  ok: result.ok,
  error: result.ok ? null : { errorCode: result.error.errorCode, diagnosticReason: result.error.diagnosticReason ?? null },
  drops: result.ok ? result.drops : null,
  malformed: result.ok ? result.malformed : null,
  totals: {
    calls: calls.length,
    inputTokens,
    outputTokens,
    modelLatencyMs: sum((c) => c.latencyMs),
    resolvedModels,
  },
  calls,
};
writeFileSync(join(runDir, "write-stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
if (!result.ok) {
  console.log(`  FAILED ${result.error.errorCode} (${result.error.diagnosticReason ?? "no reason"}); wrote write-stats.json`);
  process.exit(1);
}
writeFileSync(join(runDir, "view.json"), `${JSON.stringify(result.view, null, 2)}\n`);
writeFileSync(join(runDir, "view.html"), renderViewHtml(result.view, audience, intent));
console.log(
  `  sections ${result.view.sections.length}, blocks ${result.view.blocks.length}; ` +
    `sentences dropped ${result.drops.sentencesDropped}, unknown fact ids stripped ${result.drops.unknownFactIdsStripped}; ` +
    `tokens ${inputTokens} in / ${outputTokens} out, model ${resolvedModels.join(", ") || "unknown"}`,
);
console.log(`Wrote view.json, view.html and write-stats.json to ${runDir}\n`);

const evalRun = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "eval.ts"), corpusId, runDir], {
  stdio: "inherit",
});
process.exitCode = evalRun.status ?? 1;
