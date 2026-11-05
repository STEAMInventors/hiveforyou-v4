import type { EvidenceRef, StudyClaim } from "../analysis/study-verification";
import type { ReportAudience, ReportBlock, WriterReport } from "./writer-report-contracts";

/**
 * Bounded Semantic Review Gate (V4-005).
 *
 * Domain-neutral independent review of model-authored assertions against cited Canonical Study claims.
 * Deterministic schema, claim ID, provenance, and numeric checks run in `compileEditorialPlan` /
 * `validateWriterReport`; this module prepares assertion units, invokes an independent frontier
 * reviewer model, normalizes structured findings, and supports bounded Writer repair.
 */

export const SEMANTIC_REVIEW_SCHEMA = "hive.writer-semantic-review/1" as const;

export const SEMANTIC_REVIEW_ERROR_CODES = [
  "writer_semantic_unsupported",
  "writer_citation_misattributed",
  "writer_unsupported_conclusion",
] as const;
export type SemanticReviewErrorCode = (typeof SEMANTIC_REVIEW_ERROR_CODES)[number];

export type SemanticReviewImpact = "HIGH" | "MEDIUM";

export type SemanticReviewAssertionUnit = {
  readonly field: string;
  readonly blockType?: string;
  readonly text: string;
  readonly claimRefs: readonly string[];
};

export type SemanticReviewFinding = {
  readonly field: string;
  readonly error: SemanticReviewErrorCode;
  readonly impact: SemanticReviewImpact;
  readonly message: string;
  readonly hint: string;
  readonly citedClaimIds: readonly string[];
  readonly candidateClaimIds?: readonly string[];
};

export type SemanticReviewResult = {
  readonly schema: typeof SEMANTIC_REVIEW_SCHEMA;
  readonly ok: boolean;
  readonly reviewerSource: "frontier_reviewer";
  readonly findings: readonly SemanticReviewFinding[];
};

export type SemanticReviewClaimContext = {
  readonly id: string;
  readonly kind: StudyClaim["kind"];
  readonly text: string;
  readonly quotes: readonly string[];
  readonly refs: readonly EvidenceRef[];
  readonly answerStatus?: StudyClaim["answerStatus"];
  readonly numericStatus?: StudyClaim["numericStatus"];
  readonly criterion?: string;
};

export type WriterSemanticReviewerInput = {
  readonly audience: ReportAudience;
  readonly assertions: readonly SemanticReviewAssertionUnit[];
  readonly claims: readonly SemanticReviewClaimContext[];
};

export type WriterSemanticReviewer = (
  input: WriterSemanticReviewerInput,
) => SemanticReviewFinding[] | Promise<SemanticReviewFinding[]>;

/** Slim claim projection for reviewer context (no page payloads beyond refs). */
export function prepareSemanticReviewClaimContext(claims: readonly StudyClaim[]): SemanticReviewClaimContext[] {
  return claims.map((claim) => ({
    id: claim.id,
    kind: claim.kind,
    text: claim.text,
    quotes: [...claim.quotes],
    refs: [...claim.refs],
    ...(claim.answerStatus ? { answerStatus: claim.answerStatus } : {}),
    ...(claim.numericStatus ? { numericStatus: claim.numericStatus } : {}),
    ...(claim.criterion ? { criterion: claim.criterion } : {}),
  }));
}

function rawRowOrItem(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Collects model-authored assertion units from a compiled `WriterReport` for semantic review.
 */
export function collectReportAssertionUnits(report: WriterReport): SemanticReviewAssertionUnit[] {
  const units: SemanticReviewAssertionUnit[] = [];

  report.summary.forEach((block, index) => {
    units.push({
      field: `summary[${index}]`,
      blockType: block.type,
      text: block.text,
      claimRefs: block.claimRefs,
    });
  });

  report.sections.forEach((section, sIndex) => {
    section.blocks.forEach((block: ReportBlock, bIndex: number) => {
      units.push({
        field: `sections[${sIndex}].blocks[${bIndex}]`,
        blockType: block.type,
        text: block.text,
        claimRefs: block.claimRefs,
      });
    });
  });

  report.view.forEach((comp, cIndex) => {
    const props = comp.props;
    const basePath = `view[${cIndex}]`;
    switch (comp.component) {
      case "RecordTable":
        if (Array.isArray(props.rows)) {
          props.rows.forEach((rawRow, rIndex) => {
            if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) return;
            const row = rawRow as { cells?: unknown; claimRefs?: unknown };
            if (Array.isArray(row.cells) && Array.isArray(row.claimRefs)) {
              const cellsText = row.cells.filter((c): c is string => typeof c === "string").join(" · ");
              const refs = row.claimRefs.filter((r): r is string => typeof r === "string");
              if (cellsText.trim()) {
                units.push({ field: `${basePath}.rows[${rIndex}]`, text: cellsText, claimRefs: refs });
              }
            }
          });
        }
        break;
      case "Comparison":
        if (Array.isArray(props.items)) {
          props.items.forEach((rawItem, iIndex) => {
            if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return;
            const item = rawRowOrItem(rawItem);
            const refs = Array.isArray(item.claimRefs)
              ? item.claimRefs.filter((r): r is string => typeof r === "string")
              : [];
            const text = [item.label, item.left, item.right]
              .filter((part): part is string => typeof part === "string" && part.trim() !== "")
              .join(" — ");
            if (text && refs.length > 0) {
              units.push({ field: `${basePath}.items[${iIndex}]`, text, claimRefs: refs });
            }
          });
        }
        break;
      case "Timeline":
        if (Array.isArray(props.events)) {
          props.events.forEach((rawEvent, eIndex) => {
            if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return;
            const ev = rawRowOrItem(rawEvent);
            const refs = Array.isArray(ev.claimRefs)
              ? ev.claimRefs.filter((r): r is string => typeof r === "string")
              : [];
            const text = [ev.date, ev.text]
              .filter((part): part is string => typeof part === "string" && part.trim() !== "")
              .join(": ");
            if (text && refs.length > 0) {
              units.push({ field: `${basePath}.events[${eIndex}]`, text, claimRefs: refs });
            }
          });
        }
        break;
      case "IssueList":
        if (Array.isArray(props.issues)) {
          props.issues.forEach((rawIssue, iIndex) => {
            if (!rawIssue || typeof rawIssue !== "object" || Array.isArray(rawIssue)) return;
            const issue = rawRowOrItem(rawIssue);
            const refs = Array.isArray(issue.claimRefs)
              ? issue.claimRefs.filter((r): r is string => typeof r === "string")
              : [];
            if (typeof issue.text === "string" && issue.text.trim()) {
              units.push({ field: `${basePath}.issues[${iIndex}]`, text: issue.text, claimRefs: refs });
            }
          });
        }
        break;
      case "QuestionList":
        if (Array.isArray(props.questions)) {
          props.questions.forEach((rawQ, qIndex) => {
            if (!rawQ || typeof rawQ !== "object" || Array.isArray(rawQ)) return;
            const q = rawRowOrItem(rawQ);
            const refs = Array.isArray(q.claimRefs)
              ? q.claimRefs.filter((r): r is string => typeof r === "string")
              : [];
            if (typeof q.text === "string" && q.text.trim()) {
              units.push({ field: `${basePath}.questions[${qIndex}]`, text: q.text, claimRefs: refs });
            }
          });
        }
        break;
      case "Checklist":
        if (Array.isArray(props.items)) {
          props.items.forEach((rawItem, iIndex) => {
            if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return;
            const item = rawRowOrItem(rawItem);
            const refs = Array.isArray(item.claimRefs)
              ? item.claimRefs.filter((r): r is string => typeof r === "string")
              : [];
            if (typeof item.text === "string" && item.text.trim()) {
              units.push({ field: `${basePath}.items[${iIndex}]`, text: item.text, claimRefs: refs });
            }
          });
        }
        break;
    }
  });

  return units;
}

export function normalizeSemanticReviewFindings(
  raw: readonly SemanticReviewFinding[] | null | undefined,
): SemanticReviewFinding[] {
  return (raw ?? []).map((f) => ({
    field: f.field || "sections[0].blocks[0]",
    error: SEMANTIC_REVIEW_ERROR_CODES.includes(f.error) ? f.error : "writer_semantic_unsupported",
    impact: f.impact === "MEDIUM" ? "MEDIUM" : "HIGH",
    message: f.message,
    hint:
      f.hint ||
      "Rewrite the assertion so every statement is directly supported by its cited Canonical Study claims, or update claimRefs to match.",
    citedClaimIds: [...(f.citedClaimIds ?? [])],
    ...(f.candidateClaimIds && f.candidateClaimIds.length > 0
      ? { candidateClaimIds: [...f.candidateClaimIds] }
      : {}),
  }));
}

export function semanticReviewHasBlockingFindings(findings: readonly SemanticReviewFinding[]): boolean {
  return findings.some((f) => f.impact === "HIGH");
}

const SEMANTIC_REVIEW_REPAIR_MAX_FINDINGS = 8;

/** User message instructing bounded `patch_editorial_plan` repair after semantic review failure. */
export function buildSemanticReviewRepairMessage(findings: readonly SemanticReviewFinding[]): string {
  const blocking = findings.filter((f) => f.impact === "HIGH").slice(0, SEMANTIC_REVIEW_REPAIR_MAX_FINDINGS);
  const lines = blocking.map(
    (f) =>
      `- ${f.field} (${f.error}): ${f.message}${f.hint ? ` Hint: ${f.hint}` : ""}${
        f.candidateClaimIds && f.candidateClaimIds.length > 0 ? ` Candidate claims: [${f.candidateClaimIds.join(", ")}].` : ""
      }`,
  );
  return [
    "Independent semantic review rejected one or more assertions in the compiled report.",
    "Call patch_editorial_plan to repair ONLY the listed fields; preserve all other accepted plan elements.",
    ...lines,
  ].join("\n");
}

export function semanticReviewInvalidReviewerResponseFinding(message: string): SemanticReviewFinding {
  return {
    field: "report",
    error: "writer_semantic_unsupported",
    impact: "HIGH",
    message,
    hint: "The independent semantic reviewer must return valid hive.writer-semantic-review/1 JSON with a findings array.",
    citedClaimIds: [],
  };
}

const REVIEWER_NOT_CONFIGURED: SemanticReviewFinding = {
  field: "report",
  error: "writer_semantic_unsupported",
  impact: "HIGH",
  message: "Independent semantic reviewer is not configured for this report run.",
  hint: "Configure the frontier semantic reviewer before publishing reports.",
  citedClaimIds: [],
};

/**
 * Runs mandatory independent frontier-model semantic review over a compiled `WriterReport`.
 * Fails closed when no reviewer is supplied or when high-impact findings remain.
 */
export async function reviewWriterReportSemantics(
  report: WriterReport,
  input: {
    readonly audience: ReportAudience;
    readonly claims: readonly StudyClaim[];
    readonly externalReviewer: WriterSemanticReviewer | null | undefined;
  },
): Promise<SemanticReviewResult> {
  if (!input.externalReviewer) {
    return {
      schema: SEMANTIC_REVIEW_SCHEMA,
      ok: false,
      reviewerSource: "frontier_reviewer",
      findings: [REVIEWER_NOT_CONFIGURED],
    };
  }

  const assertions = collectReportAssertionUnits(report);
  if (assertions.length === 0) {
    return { schema: SEMANTIC_REVIEW_SCHEMA, ok: true, reviewerSource: "frontier_reviewer", findings: [] };
  }

  const externalFindings = await input.externalReviewer({
    audience: input.audience,
    assertions,
    claims: prepareSemanticReviewClaimContext(input.claims),
  });

  const findings = normalizeSemanticReviewFindings(externalFindings);
  return {
    schema: SEMANTIC_REVIEW_SCHEMA,
    ok: findings.length === 0,
    reviewerSource: "frontier_reviewer",
    findings,
  };
}
