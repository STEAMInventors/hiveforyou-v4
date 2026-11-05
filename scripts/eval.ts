// Scores one run of one corpus against eval/corpora/<corpus-id>/golden.json.
// Usage: npm run eval -- <corpus-id> <run-folder>    (run folder: eval/runs/<timestamp>/<corpus-id>/)
// Stage outputs and their shapes are described in eval/README.md. A missing stage output is
// reported as "not run"; an unreadable one as "invalid". The summary is written to
// <run-folder>/eval-summary.json.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SUMMARY_FILE = "eval-summary.json";

type Location = { file: string; page: number; quoteFragment: string };
type Golden = {
  anchorDocument: string | null;
  /** One value, or a list of acceptable values. */
  spineSource: string | string[];
  spine: { id: string; label: string; kind: string; expectedStatus: string; evidence: Location[] }[];
  conflicts: { id: string; description?: string; evidence: Location[] }[];
  gaps: { id: string; description: string }[];
  negativeControls?: { id: string; statement: string; why: string }[];
  reviewed: boolean;
};
type Evidence = { page: number; quote: string };
type ExtractDocument = { file: string; documentId: string | null; facts: { id: string; evidence: Evidence[] }[] };
type DocumentStats = {
  file: string;
  ok: boolean;
  error?: { errorCode: string; diagnosticReason: string | null } | null;
  stats: {
    factsProposed: number;
    factsIn: number;
    factsKept: number;
    evidenceIn: number;
    evidenceDropped: number;
    byReason: Record<string, number>;
    malformed: Record<string, number>;
  } | null;
};
type Extract = { documents: ExtractDocument[]; stats: DocumentStats[] };
type Cited = { id: string; label?: string; description?: string; status?: string | null; factIds?: string[] };
/** canonical.json as scored: anchor resolved to a file name, spine fact ids flattened. */
type Spine = {
  anchorDocument: string | null;
  spineSource: string | null;
  elements: Cited[];
  conflicts: Cited[];
  gaps: { id?: string; description: string }[];
};
type CanonicalFile = {
  schema?: unknown;
  documents?: { sourceDocumentId?: string; role?: string; chainPosition?: number | null }[];
  spineSource?: string | null;
  spine?: { id: string; label?: string; status?: string | null; supportingFactIds?: string[]; contradictingFactIds?: string[]; updatingFactIds?: string[] }[];
  conflicts?: { id: string; statement?: string; factIds?: string[] }[];
  gaps?: { id?: string; statement?: string }[];
};
type Stage<T> = { status: "ok"; value: T } | { status: "not run" } | { status: "invalid"; error: string };
type UsableFact = { id: string; file: string; evidence: Evidence[] };

function fail(message: string): never {
  console.error(message);
  console.error("Usage: npm run eval -- <corpus-id> <run-folder>");
  process.exit(2);
}

function readStage<T>(path: string, parse: (text: string) => T): Stage<T> {
  if (!existsSync(path)) return { status: "not run" };
  try {
    return { status: "ok", value: parse(readFileSync(path, "utf8")) };
  } catch (error) {
    return { status: "invalid", error: error instanceof Error ? error.message : String(error) };
  }
}

const EXTRACT_DIR = "extract";
const EXTRACT_STATS_FILE = "extract-stats.json";
const FACT_ID = /^F-[0-9a-z]{1,16}-\d{3,}$/;

/** Reads extract/<file>.json (hive.doc-extraction/1, final ids) and extract-stats.json. */
function readExtract(runDir: string): Stage<Extract> {
  const dir = join(runDir, EXTRACT_DIR);
  if (!existsSync(dir)) return { status: "not run" };
  try {
    const statsPath = join(runDir, EXTRACT_STATS_FILE);
    if (!existsSync(statsPath)) throw new Error(`${EXTRACT_STATS_FILE} missing`);
    const stats = (JSON.parse(readFileSync(statsPath, "utf8")) as { documents?: DocumentStats[] }).documents;
    if (!Array.isArray(stats)) throw new Error(`${EXTRACT_STATS_FILE} must have a documents array`);
    const seen = new Set<string>();
    const documents = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name): ExtractDocument => {
        const value = JSON.parse(readFileSync(join(dir, name), "utf8")) as {
          schema?: unknown;
          documentId?: unknown;
          fileName?: unknown;
          facts?: { id?: unknown; evidence?: unknown }[];
        };
        if (value?.schema !== "hive.doc-extraction/1") throw new Error(`${name}: schema must be hive.doc-extraction/1`);
        if (typeof value.fileName !== "string" || !Array.isArray(value.facts)) throw new Error(`${name}: needs fileName and facts`);
        const facts = value.facts.map((f) => {
          if (typeof f?.id !== "string" || !FACT_ID.test(f.id)) throw new Error(`${name}: fact id ${String(f?.id)} is not a final F-<doc>-NNN id`);
          if (seen.has(f.id)) throw new Error(`${name}: duplicate fact id ${f.id}`);
          seen.add(f.id);
          if (!Array.isArray(f.evidence)) throw new Error(`${name}: ${f.id} has no evidence list`);
          return { id: f.id, evidence: f.evidence as Evidence[] };
        });
        return { file: value.fileName, documentId: typeof value.documentId === "string" ? value.documentId : null, facts };
      });
    return { status: "ok", value: { documents, stats } };
  } catch (error) {
    return { status: "invalid", error: error instanceof Error ? error.message : String(error) };
  }
}

const CANONICAL_FILE = "canonical.json";
const CANONICAL_SCHEMA = "hive.canonical-study/1";

function parseCanonical(text: string): CanonicalFile {
  const value = JSON.parse(text) as CanonicalFile;
  if (value === null || typeof value !== "object") throw new Error(`${CANONICAL_FILE} must be an object`);
  if (value.schema !== CANONICAL_SCHEMA) throw new Error(`${CANONICAL_FILE}: schema must be ${CANONICAL_SCHEMA}`);
  return value;
}

/**
 * The anchor is the ANCHOR document with the highest chainPosition (the version in force), named by its
 * file through the extract outputs; without them the source document id is shown and cannot match.
 * A spine element cites its supporting, contradicting and updating facts.
 */
function toSpine(canonical: CanonicalFile, extract: Extract | null): Spine {
  const fileById = new Map((extract?.documents ?? []).flatMap((d) => (d.documentId ? [[d.documentId, d.file] as const] : [])));
  const anchor = (canonical.documents ?? [])
    .filter((d) => d.role === "ANCHOR" && typeof d.sourceDocumentId === "string")
    .sort((a, b) => (b.chainPosition ?? 0) - (a.chainPosition ?? 0))[0];
  return {
    anchorDocument: anchor ? (fileById.get(anchor.sourceDocumentId!) ?? anchor.sourceDocumentId!) : null,
    spineSource: canonical.spineSource ?? null,
    elements: (canonical.spine ?? []).map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status ?? null,
      factIds: [...(s.supportingFactIds ?? []), ...(s.contradictingFactIds ?? []), ...(s.updatingFactIds ?? [])],
    })),
    conflicts: (canonical.conflicts ?? []).map((c) => ({ id: c.id, description: c.statement, factIds: c.factIds ?? [] })),
    gaps: (canonical.gaps ?? []).map((g) => ({ id: g.id, description: g.statement ?? "" })),
  };
}

/** Case-, whitespace- and typographic-punctuation-insensitive form used for every quote comparison. */
const squash = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, "");
const sameFile = (a: string, b: string) => basename(a).toLowerCase() === basename(b).toLowerCase();
const matches = (fact: UsableFact, loc: Location) =>
  sameFile(fact.file, loc.file) &&
  fact.evidence.some((ev) => ev.page === loc.page && squash(ev.quote).includes(squash(loc.quoteFragment)));
const rate = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 1000);
const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

/**
 * Per document: facts proposed by the model, facts whose quotes were checked (well-formed), facts kept
 * (written to extract/<file>.json), quote verify rate = kept / checked, and dropped = proposed - kept.
 */
function scoreExtract(extract: Extract) {
  const addCounts = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n;
  };
  const byReason: Record<string, number> = {};
  const malformed: Record<string, number> = {};
  const documents = extract.stats.map((entry) => {
    const kept = extract.documents.find((d) => sameFile(d.file, entry.file))?.facts.length ?? 0;
    if (!entry.ok || !entry.stats) {
      return { file: entry.file, failed: entry.error?.diagnosticReason ?? entry.error?.errorCode ?? "failed", factsProposed: 0, factsChecked: 0, factsKept: 0, quoteVerifyRate: null, factsDropped: 0, evidenceIn: 0, evidenceDropped: 0, keptMismatch: false };
    }
    const s = entry.stats;
    addCounts(byReason, s.byReason);
    addCounts(malformed, s.malformed);
    return {
      file: entry.file,
      failed: null,
      factsProposed: s.factsProposed,
      factsChecked: s.factsIn,
      factsKept: kept,
      quoteVerifyRate: rate(kept, s.factsIn),
      factsDropped: s.factsProposed - kept,
      evidenceIn: s.evidenceIn,
      evidenceDropped: s.evidenceDropped,
      keptMismatch: kept !== s.factsKept,
    };
  });
  const total = (key: "factsProposed" | "factsChecked" | "factsKept" | "factsDropped" | "evidenceIn" | "evidenceDropped") =>
    documents.reduce((n, d) => n + d[key], 0);
  return {
    documents,
    total: {
      factsProposed: total("factsProposed"),
      factsChecked: total("factsChecked"),
      factsKept: total("factsKept"),
      quoteVerifyRate: rate(total("factsKept"), total("factsChecked")),
      factsDropped: total("factsDropped"),
      evidenceIn: total("evidenceIn"),
      evidenceDropped: total("evidenceDropped"),
      documentsFailed: documents.filter((d) => d.failed !== null).length,
    },
    evidenceDropReasons: Object.fromEntries(Object.entries(byReason).sort((a, b) => b[1] - a[1])),
    malformedFacts: malformed,
  };
}

/**
 * Only kept, verified facts can satisfy golden evidence: extract/<file>.json holds only facts whose
 * quotes passed verification, and dropped facts exist only as counts in extract-stats.json.
 */
function usableFacts(extract: Extract): Map<string, UsableFact> {
  const facts = new Map<string, UsableFact>();
  for (const doc of extract.documents) {
    for (const f of doc.facts) facts.set(f.id, { id: f.id, file: doc.file, evidence: f.evidence });
  }
  return facts;
}

function resolveCited(items: Cited[], facts: Map<string, UsableFact>) {
  const unresolved = new Set<string>();
  const resolved = items.map((item) => ({
    item,
    facts: (item.factIds ?? []).flatMap((id) => {
      const fact = facts.get(id);
      if (!fact) unresolved.add(id);
      return fact ? [fact] : [];
    }),
  }));
  return { resolved, unresolvedFactIds: [...unresolved] };
}

/** Golden statuses whose prediction is scored; the others are shown only. */
const SCORED_STATUSES = ["SUPERSEDED", "UNSUPPORTED"];

/**
 * A golden element is matched by the first predicted element citing a matching fact, preferring one
 * with the expected status when several match.
 */
function scoreSpine(golden: Golden, spine: Spine, facts: Map<string, UsableFact>) {
  const { resolved, unresolvedFactIds } = resolveCited(spine.elements, facts);
  const elements = golden.spine.map((g) => {
    const hits = resolved.filter((p) => p.facts.some((f) => g.evidence.some((loc) => matches(f, loc))));
    const hit = hits.find((p) => p.item.status === g.expectedStatus) ?? hits[0];
    return {
      id: g.id,
      label: g.label,
      expectedStatus: g.expectedStatus,
      matched: hit !== undefined,
      predictedId: hit?.item.id ?? null,
      predictedStatus: hit?.item.status ?? null,
    };
  });
  const matched = elements.filter((e) => e.matched).length;
  const scored = elements.filter((e) => SCORED_STATUSES.includes(e.expectedStatus));
  const status = {
    scoredStatuses: SCORED_STATUSES,
    total: scored.length,
    matched: scored.filter((e) => e.matched).length,
    sameStatus: scored.filter((e) => e.matched && e.predictedStatus === e.expectedStatus).length,
  };
  return { matched, total: elements.length, coverage: rate(matched, elements.length), status, elements, predictedElements: resolved.length, unresolvedFactIds };
}

/**
 * A golden conflict is found when one predicted conflict cites facts matching two or more of its
 * locations. Predicted conflicts that match no golden conflict are reported as unmatched.
 */
function scoreConflicts(golden: Golden, spine: Spine, facts: Map<string, UsableFact>) {
  const { resolved, unresolvedFactIds } = resolveCited(spine.conflicts, facts);
  const satisfies = (p: (typeof resolved)[number], g: Golden["conflicts"][number]) =>
    g.evidence.filter((loc) => p.facts.some((f) => matches(f, loc))).length >= Math.min(2, g.evidence.length);
  const conflicts = golden.conflicts.map((g) => {
    const hit = resolved.find((p) => satisfies(p, g));
    return { id: g.id, description: g.description ?? null, found: hit !== undefined, predictedId: hit?.item.id ?? null };
  });
  const unmatched = resolved
    .filter((p) => !golden.conflicts.some((g) => satisfies(p, g)))
    .map((p) => ({ id: p.item.id, description: p.item.description ?? null }));
  const found = conflicts.filter((c) => c.found).length;
  return { found, total: conflicts.length, conflicts, predictedConflicts: resolved.length, unmatched, unresolvedFactIds };
}

const CITATION = /\[\s*([A-Za-z][\w.:-]*\d[\w.:-]*(?:\s*[,;]\s*[A-Za-z][\w.:-]*\d[\w.:-]*)*)\s*\](?!\()/g;
const HAS_CITATION = new RegExp(CITATION.source);
const LEADING_CITATIONS = /^(?:\[[^\]]*\]\s*)+/;

function sentencesOf(markdown: string): string[] {
  const sentences: string[] = [];
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === "" || line.startsWith("#") || /^[-*_|:\s]+$/.test(line)) continue;
    const text = line.replace(/^(?:[-*+]|\d+[.)])\s+/, "").replace(/^>\s*/, "");
    for (const part of text.split(/(?<=[.!?])\s+/)) {
      const leading = part.match(LEADING_CITATIONS)?.[0];
      if (leading && sentences.length > 0) sentences[sentences.length - 1] += ` ${leading.trim()}`;
      const rest = leading ? part.slice(leading.length).trim() : part.trim();
      if (/[A-Za-z0-9]/.test(rest.replace(CITATION, ""))) sentences.push(rest);
    }
  }
  return sentences;
}

function scoreWrite(markdown: string, knownFactIds: Set<string> | null) {
  const sentences = sentencesOf(markdown);
  const uncited = sentences.filter((s) => !HAS_CITATION.test(s));
  const cited = new Set<string>();
  for (const s of sentences) for (const m of s.matchAll(CITATION)) for (const id of m[1]!.split(/[,;]/)) cited.add(id.trim());
  return {
    sentences: sentences.length,
    uncitedSentences: uncited.length,
    uncitedRate: rate(uncited.length, sentences.length),
    uncited: uncited.map((s) => (s.length > 200 ? `${s.slice(0, 197)}...` : s)),
    unknownCitationIds: knownFactIds === null ? null : [...cited].filter((id) => !knownFactIds.has(id)),
  };
}

const [corpusId, runArg] = process.argv.slice(2);
if (!corpusId || !runArg) fail("Missing arguments.");
const corpusDir = join(ROOT, "eval", "corpora", corpusId);
if (!existsSync(corpusDir)) fail(`Unknown corpus: ${corpusId} (no ${corpusDir})`);
const runDir = resolve(runArg);
if (!existsSync(runDir) || !statSync(runDir).isDirectory()) fail(`Run folder not found: ${runDir}`);

const golden = readStage<Golden>(join(corpusDir, "golden.json"), (t) => JSON.parse(t) as Golden);
const extract = readExtract(runDir);
const canonical = readStage(join(runDir, CANONICAL_FILE), parseCanonical);
const write = readStage(join(runDir, "write.md"), (t) => t);

const extractValue = extract.status === "ok" ? extract.value : null;
const spineValue = canonical.status === "ok" ? toSpine(canonical.value, extractValue) : null;
const writeValue = write.status === "ok" ? write.value : null;
const facts = extractValue ? usableFacts(extractValue) : new Map<string, UsableFact>();
const allFactIds = extractValue ? new Set(extractValue.documents.flatMap((d) => d.facts.map((f) => f.id))) : null;
const stageState = (s: Stage<unknown>) => (s.status === "invalid" ? { status: "invalid", error: s.error } : { status: s.status });

function needs(...stages: [string, Stage<unknown>][]): { status: string; reason?: string } | null {
  for (const [name, stage] of stages) {
    if (stage.status === "invalid") return { status: "invalid", reason: `${name}: ${stage.error}` };
    if (stage.status !== "ok") return { status: "not run", reason: `${name} missing` };
  }
  return null;
}

const goldenValue = golden.status === "ok" ? golden.value : null;
const noGolden = golden.status === "ok" ? null : { status: "no golden", reason: `golden.json ${golden.status}` };

const summary = {
  corpus: corpusId,
  runFolder: runDir,
  evaluatedAt: new Date().toISOString(),
  goldenReviewed: goldenValue?.reviewed ?? null,
  stages: { extract: stageState(extract), canonical: stageState(canonical), write: stageState(write) },
  extract: needs(["extract/", extract]) ?? { status: "ok", ...scoreExtract(extractValue!) },
  spineCoverage:
    noGolden ?? needs([CANONICAL_FILE, canonical], ["extract/", extract]) ??
    { status: "ok", ...scoreSpine(goldenValue!, spineValue!, facts) },
  anchor:
    noGolden ?? needs([CANONICAL_FILE, canonical]) ??
    (() => {
      const predicted = spineValue!;
      const predictedAnchor = predicted.anchorDocument;
      const anchorCorrect =
        goldenValue!.anchorDocument === null || predictedAnchor === null
          ? goldenValue!.anchorDocument === predictedAnchor
          : sameFile(goldenValue!.anchorDocument, predictedAnchor);
      const acceptable = [goldenValue!.spineSource].flat();
      return {
        status: "ok",
        anchorDocument: { expected: goldenValue!.anchorDocument, predicted: predictedAnchor, correct: anchorCorrect },
        spineSource: {
          expected: goldenValue!.spineSource,
          predicted: predicted.spineSource,
          correct: predicted.spineSource !== null && acceptable.includes(predicted.spineSource),
        },
      };
    })(),
  conflicts:
    noGolden ?? needs([CANONICAL_FILE, canonical], ["extract/", extract]) ??
    { status: "ok", ...scoreConflicts(goldenValue!, spineValue!, facts) },
  gaps:
    noGolden ?? needs([CANONICAL_FILE, canonical]) ??
    { status: "manual check", golden: goldenValue!.gaps, predicted: spineValue!.gaps },
  negativeControls:
    noGolden ?? needs([CANONICAL_FILE, canonical]) ??
    {
      status: "manual check",
      golden: goldenValue!.negativeControls ?? [],
      predictedStatements: spineValue!.elements.map((e) => ({ id: e.id, label: e.label ?? null, status: e.status ?? null })),
    },
  write: needs(["write.md", write]) ?? { status: "ok", ...scoreWrite(writeValue!, allFactIds) },
};

const yesNo = (v: boolean) => (v ? "yes" : "no");
const skipped = (section: { status: string; reason?: string }) => `${section.status}${section.reason ? ` (${section.reason})` : ""}`;
const out: string[] = [`Eval ${corpusId}  run: ${runDir}`];
if (golden.status !== "ok") out.push(`  golden.json ${golden.status}`);
else if (!goldenValue!.reviewed) out.push("  note: golden labels not yet reviewed (reviewed: false)");

const ex = summary.extract as ReturnType<typeof scoreExtract> & { status: string; reason?: string };
out.push("", "Extract");
if (ex.status !== "ok") out.push(`  ${skipped(ex)}`);
else {
  for (const d of ex.documents) {
    if (d.failed !== null) {
      out.push(`  ${d.file}: FAILED (${d.failed})`);
      continue;
    }
    const mismatch = d.keptMismatch ? " (kept count differs from extract-stats.json)" : "";
    out.push(`  ${d.file}: facts kept ${d.factsKept}/${d.factsChecked} checked (${pct(d.quoteVerifyRate)}), ${d.factsProposed} proposed, facts dropped ${d.factsDropped}, evidence dropped ${d.evidenceDropped}/${d.evidenceIn}${mismatch}`);
  }
  out.push(`  total: facts kept ${ex.total.factsKept}/${ex.total.factsChecked} checked (${pct(ex.total.quoteVerifyRate)}), ${ex.total.factsProposed} proposed, facts dropped ${ex.total.factsDropped}, evidence dropped ${ex.total.evidenceDropped}/${ex.total.evidenceIn}, documents failed ${ex.total.documentsFailed}`);
  const reasons = Object.entries(ex.evidenceDropReasons).map(([r, n]) => `${r} ${n}`);
  if (reasons.length > 0) out.push(`  evidence drop reasons: ${reasons.join(", ")}`);
  const malformed = Object.entries(ex.malformedFacts).map(([r, n]) => `${r} ${n}`);
  if (malformed.length > 0) out.push(`  malformed items dropped before verification: ${malformed.join(", ")}`);
}

const sp = summary.spineCoverage as ReturnType<typeof scoreSpine> & { status: string; reason?: string };
out.push("", "Spine coverage");
if (sp.status !== "ok") out.push(`  ${skipped(sp)}`);
else {
  out.push(`  ${sp.matched}/${sp.total} golden elements matched (${pct(sp.coverage)}) from ${sp.predictedElements} predicted`);
  out.push(`  status (${sp.status.scoredStatuses.join(", ")} only): ${sp.status.sameStatus}/${sp.status.total} matched with the same status (${sp.status.matched} matched at all)`);
  for (const e of sp.elements) out.push(`  ${e.matched ? "+" : "-"} ${e.id} ${e.label}${e.matched ? ` <- ${e.predictedId} (status ${e.predictedStatus ?? "none"}, expected ${e.expectedStatus})` : ""}`);
  if (sp.unresolvedFactIds.length > 0) out.push(`  cited fact ids not usable (missing, dropped or unverified): ${sp.unresolvedFactIds.join(", ")}`);
}

const an = summary.anchor as { status: string; reason?: string; anchorDocument?: { expected: unknown; predicted: unknown; correct: boolean }; spineSource?: { expected: unknown; predicted: unknown; correct: boolean } };
out.push("", "Anchor");
if (an.status !== "ok") out.push(`  ${skipped(an)}`);
else {
  out.push(`  anchor correct: ${yesNo(an.anchorDocument!.correct)} (expected ${an.anchorDocument!.expected}, predicted ${an.anchorDocument!.predicted})`);
  out.push(`  spineSource correct: ${yesNo(an.spineSource!.correct)} (expected ${[an.spineSource!.expected].flat().join(" or ")}, predicted ${an.spineSource!.predicted})`);
}

const co = summary.conflicts as ReturnType<typeof scoreConflicts> & { status: string; reason?: string };
out.push("", "Conflicts");
if (co.status !== "ok") out.push(`  ${skipped(co)}`);
else {
  out.push(`  ${co.found}/${co.total} golden conflicts found from ${co.predictedConflicts} predicted`);
  for (const c of co.conflicts) out.push(`  ${c.found ? "+" : "-"} ${c.id}${c.found ? ` <- ${c.predictedId}` : ""}`);
  const note = co.total === 0 && co.unmatched.length > 0 ? " (no golden conflicts: each is a false positive)" : "";
  out.push(`  unmatched conflicts: ${co.unmatched.length}${note}`);
  for (const u of co.unmatched) out.push(`    ? ${u.id}${u.description ? `: ${u.description}` : ""}`);
}

const ga = summary.gaps as { status: string; reason?: string; golden?: Golden["gaps"]; predicted?: Spine["gaps"] };
out.push("", "Gaps (manual check)");
if (ga.status !== "manual check") out.push(`  ${skipped(ga)}`);
else {
  for (const g of ga.golden!) out.push(`  golden ${g.id}: ${g.description}`);
  if (ga.golden!.length === 0) out.push("  golden: none planted");
  for (const g of ga.predicted!) out.push(`  predicted ${g.id ?? "-"}: ${g.description}`);
  if (ga.predicted!.length === 0) out.push("  predicted: none");
}

const nc = summary.negativeControls as {
  status: string;
  reason?: string;
  golden?: NonNullable<Golden["negativeControls"]>;
  predictedStatements?: { id: string; label: string | null; status: string | null }[];
};
out.push("", "Negative controls (manual check: no predicted statement may assert these)");
if (nc.status !== "manual check") out.push(`  ${skipped(nc)}`);
else {
  for (const n of nc.golden!) out.push(`  must not claim ${n.id}: ${n.statement}`, `      why: ${n.why}`);
  if (nc.golden!.length === 0) out.push("  golden: none defined");
  for (const p of nc.predictedStatements!) out.push(`  predicted ${p.id}: ${p.label ?? "(no label)"}${p.status ? ` [${p.status}]` : ""}`);
  if (nc.predictedStatements!.length === 0) out.push("  predicted: none");
}

const wr = summary.write as ReturnType<typeof scoreWrite> & { status: string; reason?: string };
out.push("", "Write");
if (wr.status !== "ok") out.push(`  ${skipped(wr)}`);
else {
  out.push(`  uncited sentences: ${wr.uncitedSentences}/${wr.sentences} (${pct(wr.uncitedRate)})`);
  for (const s of wr.uncited) out.push(`    - ${s}`);
  if (wr.unknownCitationIds && wr.unknownCitationIds.length > 0) out.push(`  citations to unknown fact ids: ${wr.unknownCitationIds.join(", ")}`);
}

const summaryPath = join(runDir, SUMMARY_FILE);
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
out.push("", `Summary written to ${summaryPath}`);
console.log(out.join("\n"));
if ([extract, canonical, write, golden].some((s) => s.status === "invalid")) process.exitCode = 1;
