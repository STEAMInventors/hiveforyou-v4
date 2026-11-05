// Runs hive-extract/1 over every PDF of one synthetic eval corpus through the planner `extract` task.
// Usage: npm run extract -- <corpus-id> [run-timestamp]
// Needs PLANNER_BASE_URL and PLANNER_SERVICE_TOKEN. Page text comes from the Reader (readDocument) when
// READER_BASE_URL and READER_SERVICE_TOKEN are set; the Reader reads from the source-documents bucket, so
// the PDFs must then be stored at <EVAL_OWNER_ID>/<EVAL_HIVE_ID>/eval/<corpus-id>/<file>. Otherwise the text
// is extracted locally with unpdf and the stats say "local text".
// Writes eval/runs/<timestamp>/<corpus-id>/extract/<file>.json (hive.doc-extraction/1, final ids) and
// eval/runs/<timestamp>/<corpus-id>/extract-stats.json (drops, per-call tokens, latency, finish reason).

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { documentKeyFor, type Hive, type VerificationPage } from "@hiveforyou/contracts";
import { computeSha256Hex, HIVE_SOURCE_DOCUMENTS_BUCKET } from "@hiveforyou/contracts/document-read";
import { extractText, getDocumentProxy } from "unpdf";

import { extractDocument } from "../apps/web/src/server/pipeline/extract-runner";
import { readDocument } from "../apps/web/src/server/source-documents/read-document";
import { loadPlannerServiceConfig } from "../apps/web/src/server/study-preparation/planner-client";
import { loadPromptCatalog } from "../apps/web/src/server/study-preparation/prompt-catalog";

const ROOT = resolve(import.meta.dirname, "..");
const CONCURRENCY = 4;
const EVAL_OWNER_ID = "e0a1e0a1-0000-4000-8000-000000000001";
const EVAL_HIVE_ID = "e0a1e0a1-0000-4000-8000-000000000002";

function fail(message: string): never {
  console.error(message);
  console.error("Usage: npm run extract -- <corpus-id> [run-timestamp]");
  process.exit(2);
}

/** Stable UUID-shaped id per corpus file, so fact ids repeat across runs. */
function evalDocumentId(corpusId: string, file: string): string {
  const hex = createHash("sha256").update(`eval:${corpusId}/${file}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function timestamp(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}${two(d.getMinutes())}`;
}

async function localPages(bytes: Buffer): Promise<VerificationPage[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((pageText, index) => ({ pageNumber: index + 1, text: pageText }));
}

async function readerPages(corpusId: string, file: string, bytes: Buffer, documentId: string, correlationId: string) {
  const result = await readDocument(
    { loadOwnedHive: async () => ({ id: EVAL_HIVE_ID }) as Hive },
    {
      hiveId: EVAL_HIVE_ID,
      ownerUserId: EVAL_OWNER_ID,
      sourceDocumentId: documentId,
      storageBucket: HIVE_SOURCE_DOCUMENTS_BUCKET,
      storagePath: `${EVAL_OWNER_ID}/${EVAL_HIVE_ID}/eval/${corpusId}/${file}`,
      fileName: file,
      mimeType: "application/pdf",
      byteSize: bytes.length,
      sha256: computeSha256Hex(bytes),
      correlationId,
    },
  );
  return result.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text }));
}

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const [corpusId, runStamp] = process.argv.slice(2);
if (!corpusId) fail("Missing corpus id.");
const docsDir = join(ROOT, "eval", "corpora", corpusId, "docs");
if (!existsSync(docsDir)) fail(`Unknown corpus: ${corpusId} (no ${docsDir})`);
const files = readdirSync(docsDir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
if (files.length === 0) fail(`No PDFs in ${docsDir}`);
const keys = new Set(files.map((file) => documentKeyFor(evalDocumentId(corpusId, file))));
if (keys.size !== files.length) fail(`Document keys collide in ${corpusId}; fact ids would not be unique.`);

const correlationId = randomUUID();
const runId = randomUUID();
const plannerConfig = (() => {
  try {
    return loadPlannerServiceConfig(process.env, correlationId);
  } catch {
    return fail("PLANNER_BASE_URL and PLANNER_SERVICE_TOKEN must be set.");
  }
})();
const useReader = Boolean(process.env.READER_BASE_URL?.trim() && process.env.READER_SERVICE_TOKEN?.trim());
const textSource = useReader ? "reader" : "local text (unpdf)";
const prompt = loadPromptCatalog(ROOT).extract;
const runDir = join(ROOT, "eval", "runs", runStamp ?? timestamp(), corpusId);
const extractDir = join(runDir, "extract");
mkdirSync(extractDir, { recursive: true });

console.log(`Extract ${corpusId}: ${files.length} documents, text: ${textSource}, prompt ${prompt.id} ${prompt.digest.slice(0, 19)}`);
const started = Date.now();
const documents = await pool(files, CONCURRENCY, async (file) => {
  const bytes = readFileSync(join(docsDir, file));
  const documentId = evalDocumentId(corpusId, file);
  const pages = useReader
    ? await readerPages(corpusId, file, bytes, documentId, correlationId)
    : await localPages(bytes);
  const result = await extractDocument({
    planner: { getConfig: () => plannerConfig },
    document: { id: documentId, fileName: file },
    pages,
    correlationId,
    runId,
    prompt,
  });
  const stem = basename(file, ".pdf");
  const summary = {
    file,
    documentId,
    documentKey: documentKeyFor(documentId),
    pages: pages.length,
    blankPages: pages.filter((p) => p.text.trim() === "").map((p) => p.pageNumber),
    ok: result.ok,
    calls: result.calls,
  };
  if (!result.ok) {
    console.log(`  ${file}: FAILED ${result.error.errorCode} (${result.error.diagnosticReason ?? "no reason"})`);
    return { ...summary, error: { errorCode: result.error.errorCode, diagnosticReason: result.error.diagnosticReason ?? null }, stats: null };
  }
  writeFileSync(join(extractDir, `${stem}.json`), `${JSON.stringify(result.extraction, null, 2)}\n`);
  const s = result.stats;
  console.log(`  ${file}: ${s.factsKept}/${s.factsIn} facts kept (${s.factsProposed} proposed), evidence dropped ${s.evidenceDropped}`);
  return { ...summary, error: null, stats: s };
});

const calls = documents.flatMap((d) => d.calls);
const sum = (pick: (s: NonNullable<(typeof documents)[number]["stats"]>) => number) =>
  documents.reduce((n, d) => n + (d.stats ? pick(d.stats) : 0), 0);
const stats = {
  schema: "hive.extract-run-stats/1",
  corpus: corpusId,
  runAt: new Date().toISOString(),
  wallClockMs: Date.now() - started,
  textSource,
  promptId: prompt.id,
  promptDigest: prompt.digest,
  totals: {
    documents: documents.length,
    documentsFailed: documents.filter((d) => !d.ok).length,
    factsProposed: sum((s) => s.factsProposed),
    factsIn: sum((s) => s.factsIn),
    factsKept: sum((s) => s.factsKept),
    evidenceIn: sum((s) => s.evidenceIn),
    evidenceDropped: sum((s) => s.evidenceDropped),
    calls: calls.length,
    inputTokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
    outputTokens: calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
  },
  documents,
};
writeFileSync(join(runDir, "extract-stats.json"), `${JSON.stringify(stats, null, 2)}\n`);
console.log(`Wrote ${extractDir} and extract-stats.json (${stats.totals.factsKept}/${stats.totals.factsIn} facts kept, ${calls.length} calls)`);
if (stats.totals.documentsFailed > 0) process.exitCode = 1;
