// Runs hive-canonicalize/1 over the extract outputs of one run folder through the planner `canonicalize`
// task, then scores the run with scripts/eval.ts.
// Usage: npm run canonicalize -- <corpus-id> <run-folder> [--brief]
// Needs PLANNER_BASE_URL and PLANNER_SERVICE_TOKEN, and <run-folder>/extract/*.json from `npm run extract`.
// --brief first asks for a 10-line domain brief from the document identity blocks only (brief.txt) and
// passes it to hive-canonicalize/1.
// Writes <run-folder>/canonical.json (hive.canonical-study/1, verified, code-assigned ids) and
// <run-folder>/canonicalize-stats.json (drops, malformed items, per-call tokens, latency, resolved model).

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { DOC_EXTRACTION_SCHEMA, type DocExtraction } from "@hiveforyou/contracts";

import { canonicalizeCase, type CanonicalizeCallRecord, draftDomainBrief } from "../apps/web/src/server/pipeline/canonicalize-runner";
import { loadPlannerServiceConfig } from "../apps/web/src/server/study-preparation/planner-client";
import { loadPromptCatalog } from "../apps/web/src/server/study-preparation/prompt-catalog";

const ROOT = resolve(import.meta.dirname, "..");

function fail(message: string): never {
  console.error(message);
  console.error("Usage: npm run canonicalize -- <corpus-id> <run-folder> [--brief]");
  process.exit(2);
}

const args = process.argv.slice(2);
const withBrief = args.includes("--brief");
const [corpusId, runArg] = args.filter((a) => a !== "--brief");
if (!corpusId || !runArg) fail("Missing arguments.");
const runDir = resolve(runArg);
const extractDir = join(runDir, "extract");
if (!existsSync(extractDir)) fail(`No extract outputs in ${runDir}; run npm run extract first.`);

const extractions = readdirSync(extractDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => {
    const value = JSON.parse(readFileSync(join(extractDir, name), "utf8")) as DocExtraction;
    if (value?.schema !== DOC_EXTRACTION_SCHEMA) fail(`${name}: schema must be ${DOC_EXTRACTION_SCHEMA}`);
    return value;
  });
if (extractions.length === 0) fail(`No extract outputs in ${extractDir}`);
const statsPath = join(runDir, "extract-stats.json");
const failedDocuments = existsSync(statsPath)
  ? ((JSON.parse(readFileSync(statsPath, "utf8")) as { documents?: { file: string; ok: boolean }[] }).documents ?? [])
      .filter((d) => !d.ok)
      .map((d) => d.file)
  : [];
if (failedDocuments.length > 0) console.warn(`Warning: extraction failed for ${failedDocuments.join(", ")}; the case is incomplete.`);

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
const prompt = loadPromptCatalog(ROOT).canonicalize;

console.log(`Canonicalize ${corpusId}: ${extractions.length} documents, ${extractions.reduce((n, e) => n + e.facts.length, 0)} facts, brief: ${withBrief ? "yes" : "no"}, prompt ${prompt.id} ${prompt.digest.slice(0, 19)}`);
const calls: CanonicalizeCallRecord[] = [];
let domainBrief: string | null = null;
if (withBrief) {
  const brief = await draftDomainBrief({ planner, extractions, correlationId, runId });
  calls.push(...brief.calls);
  if (!brief.ok) fail(`Domain brief failed: ${brief.error.errorCode} (${brief.error.diagnosticReason ?? "no reason"})`);
  domainBrief = brief.brief;
  writeFileSync(join(runDir, "brief.txt"), `${domainBrief}\n`);
  console.log(`  brief: ${domainBrief.split("\n").length} lines -> brief.txt`);
}

const started = Date.now();
const result = await canonicalizeCase({ planner, extractions, domainBrief, correlationId, runId, prompt });
calls.push(...result.calls);

const sum = (pick: (c: CanonicalizeCallRecord) => number | null) => calls.reduce((n, c) => n + (pick(c) ?? 0), 0);
const inputTokens = sum((c) => c.inputTokens);
const outputTokens = sum((c) => c.outputTokens);
const resolvedModels = [...new Set(calls.flatMap((c) => (c.resolvedModel ? [c.resolvedModel] : [])))];
const stats = {
  schema: "hive.canonicalize-run-stats/1",
  corpus: corpusId,
  runAt: new Date().toISOString(),
  wallClockMs: Date.now() - started,
  promptId: prompt.id,
  promptDigest: prompt.digest,
  withBrief,
  documents: extractions.length,
  documentsFailedInExtract: failedDocuments,
  facts: extractions.reduce((n, e) => n + e.facts.length, 0),
  payloadBytes: result.ok ? result.payloadBytes : null,
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
writeFileSync(join(runDir, "canonicalize-stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
if (!result.ok) {
  console.log(`  FAILED ${result.error.errorCode} (${result.error.diagnosticReason ?? "no reason"}); wrote canonicalize-stats.json`);
  process.exit(1);
}
writeFileSync(join(runDir, "canonical.json"), `${JSON.stringify(result.study, null, 2)}\n`);
const d = result.drops;
console.log(
  `  spine ${result.study.spine.length}, conflicts ${result.study.conflicts.length}, gaps ${result.study.gaps.length}; ` +
    `dropped fact ids ${d.unknownFactIds}, marked unsupported ${d.spineMarkedUnsupported}, conflicts dropped ${d.conflictsDropped}; ` +
    `tokens ${inputTokens} in / ${outputTokens} out, model ${resolvedModels.join(", ") || "unknown"}`,
);
console.log(`Wrote canonical.json and canonicalize-stats.json to ${runDir}\n`);

const evalRun = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "eval.ts"), corpusId, runDir], {
  stdio: "inherit",
});
process.exitCode = evalRun.status ?? 1;
