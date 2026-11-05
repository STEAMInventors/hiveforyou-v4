// Exports a finished V5 UI run into eval/runs/<timestamp>/<corpus-id>/ and scores it with scripts/eval.ts.
// Usage: npm run export-run -- <processingRunId> <corpus-id>
// Loads SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy service-role keys) from apps/web/.env.local when unset.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { DOC_EXTRACTION_SCHEMA } from "@hiveforyou/contracts";

const ROOT = resolve(import.meta.dirname, "..");

function fail(message: string): never {
  console.error(message);
  console.error("Usage: npm run export-run -- <processingRunId> <corpus-id>");
  process.exit(2);
}

function loadEnvLocal() {
  const path = join(ROOT, "apps/web/.env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function timestamp(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}${two(d.getMinutes())}`;
}

type ExportPayload = {
  sourceSnapshot?: { documents?: { sourceDocumentId?: string; fileName?: string }[] };
  studyRevision?: { investigation?: unknown };
  extractions?: { sourceDocumentId?: string; extraction?: Record<string, unknown>; stats?: unknown }[];
  reports?: {
    audience?: string;
    view?: unknown;
    writerOutput?: { calls?: unknown[]; drops?: unknown; malformed?: unknown };
    title?: string;
    modelAlias?: string | null;
    resolvedModel?: string | null;
  }[];
};

const [processingRunId, corpusId] = process.argv.slice(2);
if (!processingRunId || !corpusId) fail("Missing arguments.");

loadEnvLocal();
const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const key =
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.SUPABASE_SERVICE_KEY?.trim() ||
  "";
if (!url || !key) fail("Set SUPABASE_URL and SUPABASE_SECRET_KEY in apps/web/.env.local or the environment.");

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await client.rpc("get_v5_run_export", { p_processing_run_id: processingRunId });
if (error) fail(`get_v5_run_export failed: ${error.message}`);
const payload = data as ExportPayload;

const fileByDocId = new Map<string, string>();
for (const document of payload.sourceSnapshot?.documents ?? []) {
  if (typeof document.sourceDocumentId === "string" && typeof document.fileName === "string") {
    fileByDocId.set(document.sourceDocumentId.toLowerCase(), document.fileName);
  }
}

const runDir = join(ROOT, "eval", "runs", timestamp(), corpusId);
const extractDir = join(runDir, "extract");
mkdirSync(extractDir, { recursive: true });

const extractStatsDocuments: Record<string, unknown>[] = [];
for (const row of payload.extractions ?? []) {
  const extraction = row.extraction;
  if (!extraction || extraction.schema !== DOC_EXTRACTION_SCHEMA) continue;
  const docId = typeof row.sourceDocumentId === "string" ? row.sourceDocumentId : "";
  const fileName = fileByDocId.get(docId.toLowerCase()) ?? (typeof extraction.fileName === "string" ? extraction.fileName : `${docId}.pdf`);
  const safeName = basename(fileName).replace(/[^\w.-]+/g, "_");
  writeFileSync(join(extractDir, `${safeName}.json`), `${JSON.stringify({ ...extraction, fileName }, null, 2)}\n`);
  const stats = (row.stats ?? {}) as Record<string, unknown>;
  extractStatsDocuments.push({
    file: fileName,
    ok: true,
    error: null,
    stats: {
      factsProposed: stats.factsProposed ?? 0,
      factsIn: stats.factsIn ?? stats.factsKept ?? 0,
      factsKept: stats.factsKept ?? 0,
      evidenceIn: stats.evidenceIn ?? 0,
      evidenceDropped: stats.evidenceDropped ?? 0,
      byReason: stats.byReason ?? {},
      malformed: stats.malformed ?? {},
    },
  });
}
writeFileSync(
  join(runDir, "extract-stats.json"),
  `${JSON.stringify({ schema: "hive.extract-run-stats/1", documents: extractStatsDocuments }, null, 2)}\n`,
);

if (payload.studyRevision?.investigation) {
  writeFileSync(join(runDir, "canonical.json"), `${JSON.stringify(payload.studyRevision.investigation, null, 2)}\n`);
}

for (const report of payload.reports ?? []) {
  const audience = report.audience === "PRO" ? "PRO" : "CUSTOMER";
  if (report.view) {
    const viewPath = audience === "CUSTOMER" ? join(runDir, "view.json") : join(runDir, "view-pro.json");
    writeFileSync(viewPath, `${JSON.stringify(report.view, null, 2)}\n`);
  }
  const writer = report.writerOutput;
  if (writer) {
    const statsPath = audience === "CUSTOMER" ? join(runDir, "write-stats.json") : join(runDir, "write-stats-pro.json");
    writeFileSync(
      statsPath,
      `${JSON.stringify(
        {
          schema: "hive.write-run-stats/1",
          corpus: corpusId,
          runAt: new Date().toISOString(),
          audience,
          title: report.title ?? null,
          modelAlias: report.modelAlias ?? null,
          resolvedModel: report.resolvedModel ?? null,
          calls: writer.calls ?? [],
          drops: writer.drops ?? null,
          malformed: writer.malformed ?? null,
          ok: true,
        },
        null,
        2,
      )}\n`,
    );
  }
}

console.log(`Exported run ${processingRunId} to ${runDir}`);
const evalRun = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", join(ROOT, "scripts", "eval.ts"), corpusId, runDir], {
  stdio: "inherit",
});
process.exitCode = evalRun.status ?? 1;
