import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../..");

const SCAN_ROOTS = [join(ROOT, "apps/web/src"), join(ROOT, "packages/contracts/src")] as const;

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

/** removed in V5-006 — legacy agentic pipeline, Writer, planning contracts and fixtures. */
const V5_006_ALLOWLIST = new Set<string>([
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
]);

function shouldScanFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.endsWith(".test.ts") || normalized.endsWith(".test.tsx")) return false;
  if (normalized.includes("/fixtures/") || normalized.includes("/testing/")) return false;
  if (normalized.includes("/eval/")) return false;
  return normalized.endsWith(".ts") || normalized.endsWith(".tsx");
}

function walk(dir: string, into: string[]) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, into);
    else into.push(path);
  }
}

function scanHits(): { file: string; line: number; term: string }[] {
  const hits: { file: string; line: number; term: string }[] = [];
  for (const root of SCAN_ROOTS) {
    const files: string[] = [];
    walk(root, files);
    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (!shouldScanFile(rel)) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((text, index) => {
        for (const term of DOMAIN_TERMS) {
          if (term.pattern.test(text)) hits.push({ file: rel, line: index + 1, term: term.label });
        }
      });
    }
  }
  return hits;
}

describe("domain-word lint (D-053)", () => {
  it(
    "prints file:line for domain-specific terms outside the V5-006 removal allowlist",
    () => {
    const violations = scanHits().filter((hit) => !V5_006_ALLOWLIST.has(hit.file));
    if (violations.length > 0) {
      const report = violations.map((hit) => `${hit.file}:${hit.line} (${hit.term})`).join("\n");
      // eslint-disable-next-line no-console -- test harness output for CI and local runs
      console.log(report);
    }
    expect(violations).toEqual([]);
    },
    30_000,
  );
});
