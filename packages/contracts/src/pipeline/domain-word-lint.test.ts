import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parsePackMarkdown } from "./pack-contracts";

const ROOT = resolve(import.meta.dirname, "../../../..");

const SCAN_ROOTS = [join(ROOT, "apps"), join(ROOT, "packages")] as const;

/** Skipped path segments (build output and dependencies only). */
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "dist", ".turbo"]);

/** V4 Study UI and agentic workflow tests still on domain fixtures until V5-006. */
const V5_006_LEGACY_PATH_PREFIXES = [
  "apps/web/src/components/study/",
  "apps/web/src/server/workflow/",
] as const;

const DOMAIN_TERMS: { label: string; pattern: RegExp }[] = [
  { label: "iep", pattern: /\biep\b/i },
  { label: "special education", pattern: /special education/i },
  { label: "student", pattern: /\bstudent\b/i },
  { label: "medicaid", pattern: /\bmedicaid\b/i },
  { label: "bankruptcy", pattern: /\bbankruptcy\b/i },
  { label: "debtor", pattern: /\bdebtor\b/i },
  { label: "creditor", pattern: /\bcreditor\b/i },
  { label: "chapter 13", pattern: /chapter 13/i },
  { label: "claimant", pattern: /\bclaimant\b/i },
  { label: "patient", pattern: /\bpatient\b/i },
  { label: "diagnosis", pattern: /\bdiagnosis\b/i },
];

/**
 * Legacy V4 agentic pipeline, Writer, and domain fixtures — removed in V5-006.
 * Only these paths are excluded from domain-word rules; everything else under apps/ and packages/ is scanned.
 */
const V5_006_LEGACY_EXCLUSIONS = new Set<string>([
  "apps/web/src/server/workflow/study-investigation.ts",
  "apps/web/src/server/workflow/study-investigation.test.ts",
  "apps/web/src/server/workflow/writer-semantic-reviewer.ts",
  "apps/web/src/server/study-preparation/study-prompt-builder.ts",
  "apps/web/src/server/study-preparation/provisional-domain-context.ts",
  "apps/web/src/server/study-preparation/provisional-domain-context.test.ts",
  "packages/contracts/src/reports/writer-agent.ts",
  "packages/contracts/src/reports/writer-agent.test.ts",
  "packages/contracts/src/reports/writer-agent-editorial.test.ts",
  "packages/contracts/src/reports/editorial-plan-compiler.ts",
  "packages/contracts/src/reports/editorial-plan-compiler.test.ts",
  "packages/contracts/src/reports/writer-report-contracts.ts",
  "packages/contracts/src/reports/editorial-plan-fixtures.ts",
  "packages/contracts/src/reports/agentic-study-a2ui.test.ts",
  "packages/contracts/src/analysis/study-agent.ts",
  "packages/contracts/src/analysis/study-agent.test.ts",
  "packages/contracts/src/analysis/study-agent-budget.test.ts",
  "packages/contracts/src/analysis/study-agent-reconciliation.test.ts",
  "packages/contracts/src/study-preparation/planning-output-contracts.test.ts",
  "packages/contracts/src/study-preparation/investigation-plan-supplement.test.ts",
  "packages/contracts/src/study-preparation/investigation-plan-deterministic.test.ts",
  "packages/contracts/src/study-preparation/audience-contracts.test.ts",
  "packages/contracts/src/testing/maya-fixture.ts",
  "packages/contracts/src/analysis/canonical-finding-resolver.test.ts",
  "packages/contracts/src/analysis/corpus-reconciliation.test.ts",
  "packages/contracts/src/reports/writer-report-contracts.test.ts",
  "apps/web/src/components/reports/ReportsPanel.test.tsx",
  "apps/web/src/components/hives/DocumentsPanel.test.tsx",
]);

/**
 * Single-word pack Terms that are ordinary English and must not forbid unrelated code
 * (e.g. route tests "POST schedules no work…", fixture file names).
 */
const PACK_TERM_ORDINARY_WORDS = new Set(["schedules"]);

const PACK_PHRASE_STOPWORDS = new Set(
  [
    "the",
    "a",
    "an",
    "and",
    "or",
    "for",
    "with",
    "from",
    "when",
    "before",
    "after",
    "each",
    "all",
    "any",
    "can",
    "you",
    "your",
    "has",
    "have",
    "had",
    "was",
    "were",
    "are",
    "been",
    "will",
    "may",
    "must",
    "that",
    "this",
    "what",
    "which",
    "where",
    "while",
    "about",
    "under",
    "over",
    "between",
    "during",
    "through",
    "within",
    "without",
    "signed",
    "copy",
    "written",
    "record",
    "records",
    "form",
    "forms",
    "date",
    "dates",
    "meeting",
    "notice",
    "report",
    "parent",
    "child",
    "consent",
    "services",
    "evaluate",
    "evaluation",
    "school",
    "plan",
    "initial",
    "current",
    "change",
    "return",
    "test",
    "environment",
    "client",
    "professional",
    "customer",
    "document",
    "documents",
    "first",
    "time",
    "into",
    "only",
    "also",
    "than",
    "then",
    "into",
    "upon",
    "other",
    "such",
    "being",
    "given",
    "made",
    "make",
    "does",
    "did",
    "not",
    "but",
    "how",
    "who",
    "they",
    "them",
    "their",
    "there",
    "here",
    "would",
    "could",
    "should",
    "shall",
  ].map((term) => term.toLowerCase()),
);

function isExcludedPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (V5_006_LEGACY_EXCLUSIONS.has(normalized)) return true;
  if (normalized === "packages/contracts/src/pipeline/domain-word-lint.test.ts") return true;
  return V5_006_LEGACY_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function shouldScanFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (isExcludedPath(normalized)) return false;
  if (normalized.includes("/eval/")) return false;
  if (SKIP_DIR_NAMES.has(normalized.split("/").find(Boolean) ?? "")) return false;
  return normalized.endsWith(".ts") || normalized.endsWith(".tsx");
}

function walk(dir: string, into: string[]) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, into);
    else into.push(path);
  }
}

function scanFiles(): string[] {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    if (statSync(root, { throwIfNoEntry: false })?.isDirectory()) walk(root, files);
  }
  return files.map((file) => file.replace(/\\/g, "/"));
}

function collectSourcePaths(): string[] {
  return scanFiles()
    .map((file) => relative(ROOT, file).replace(/\\/g, "/"))
    .filter(shouldScanFile);
}

function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantPhraseWords(phrase: string): string[] {
  return normalizePhrase(phrase)
    .split(" ")
    .filter((token) => token.length >= 3 && !PACK_PHRASE_STOPWORDS.has(token));
}

type PackForbiddenTerm = { label: string; pattern: RegExp };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function forbiddenTermsFromPacks(): PackForbiddenTerm[] {
  const packsDir = join(ROOT, "packs");
  const phrases = new Set<string>();
  const termLabels = new Set<string>();

  const addPhraseSource = (raw: string) => {
    const words = significantPhraseWords(raw);
    if (words.length < 2) return;
    const phrase = words.join(" ");
    if (phrase.length >= 12) phrases.add(phrase);
  };

  for (const name of readdirSync(packsDir)) {
    if (!name.endsWith(".md")) continue;
    const parsed = parsePackMarkdown(readFileSync(join(packsDir, name), "utf8"));
    if (!parsed.ok) continue;
    const pack = parsed.value;
    for (const row of pack.documentsUsuallyNeeded) {
      addPhraseSource(row.document);
      const bracket = /\(([^)]+)\)/.exec(row.holder);
      if (bracket?.[1]) addPhraseSource(bracket[1]);
    }
    for (const term of pack.terms) {
      const label = normalizePhrase(term.term);
      if (label.length >= 3 && !PACK_TERM_ORDINARY_WORDS.has(label)) termLabels.add(label);
    }
    for (const persona of pack.personas) addPhraseSource(persona.who);
  }

  const terms: PackForbiddenTerm[] = [];
  for (const phrase of phrases) {
    terms.push({ label: phrase, pattern: new RegExp(escapeRegExp(phrase), "i") });
  }
  for (const token of termLabels) {
    terms.push({ label: token, pattern: new RegExp(`\\b${escapeRegExp(token)}\\b`, "i") });
  }
  return terms;
}

function scanRuleHits(terms: readonly { label: string; pattern: RegExp }[], rule: string): { file: string; line: number; term: string; rule: string }[] {
  const hits: { file: string; line: number; term: string; rule: string }[] = [];
  for (const rel of collectSourcePaths()) {
    const file = join(ROOT, rel);
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((text, index) => {
      for (const term of terms) {
        if (term.pattern.test(text)) hits.push({ file: rel, line: index + 1, term: term.label, rule });
      }
    });
  }
  return hits;
}

function formatHits(hits: { file: string; line: number; term: string; rule: string }[]): string {
  return hits.map((hit) => `${hit.file}:${hit.line} [${hit.rule}] (${hit.term})`).join("\n");
}

describe("domain-word lint (D-053)", () => {
  const packTerms = forbiddenTermsFromPacks();

  it(
    "scans all apps/ and packages/ TypeScript sources and tests except V5_006_LEGACY_EXCLUSIONS and eval/",
    () => {
      const scanned = collectSourcePaths();
      expect(scanned.length).toBeGreaterThan(50);
      expect(scanned.some((path) => path.includes(".test.ts"))).toBe(true);
      expect(scanned.every((path) => !path.includes("/eval/"))).toBe(true);
    },
    30_000,
  );

  it(
    "rule: fixed domain vocabulary must not appear outside V5_006_LEGACY_EXCLUSIONS",
    () => {
      const violations = scanRuleHits(DOMAIN_TERMS, "domain-vocabulary");
      if (violations.length > 0) {
        // eslint-disable-next-line no-console -- test harness output for CI and local runs
        console.log(`domain-vocabulary violations:\n${formatHits(violations)}`);
      }
      expect(violations).toEqual([]);
    },
    120_000,
  );

  it("skips ordinary-word pack Terms but still forbids other single-word Terms from intake pack", () => {
    expect(packTerms.some((term) => term.label === "schedules")).toBe(false);
    expect(packTerms.some((term) => term.label === "garnishment")).toBe(true);
  });

  it(
    "rule: pack-derived document names, holder labels, terms and persona Who must not appear in V5 code",
    () => {
      const violations = scanRuleHits(packTerms, "pack-derived");
      if (violations.length > 0) {
        // eslint-disable-next-line no-console -- test harness output for CI and local runs
        console.log(`pack-derived violations:\n${formatHits(violations)}`);
      }
      expect(violations).toEqual([]);
    },
    120_000,
  );
});
