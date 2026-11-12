import type { CanonicalStudy } from "../pipeline/canonical-study-contracts";
import type { ProcessingRun, StudyRevisionFormat, StudyRevisionSummary } from "./study-preparation-contracts";

export type StudyRevisionAcceptanceCounts = {
  verifiedFacts: number;
  documents: number;
  checklistShown?: number;
  checklistNotShown?: number;
  packReview?: { id: string; version: number; title: string };
};

const SHOWN_VERDICTS = new Set(["SHOWN", "PARTLY_SHOWN"]);
const NOT_SHOWN_VERDICTS = new Set(["NOT_SHOWN"]);

/** Unique fact ids cited on the accepted Canonical Study (V5). */
export function countVerifiedFactIds(study: CanonicalStudy): number {
  const ids = new Set<string>();
  const add = (list: readonly string[]) => list.forEach((id) => id && ids.add(id));
  for (const node of study.spine) add(node.supportingFactIds);
  for (const item of study.outsideSpine) add(item.factIds);
  for (const item of study.conflicts) add(item.factIds);
  for (const item of study.timeline) add(item.factIds);
  for (const item of study.checklist ?? []) add(item.factIds);
  for (const item of study.standingQuestions ?? []) add(item.factIds);
  for (const item of study.personaCoverage ?? []) add(item.factIds);
  for (const chain of study.chains ?? []) {
    for (const row of chain.rows) {
      for (const cell of row.links) {
        if ("factIds" in cell) add(cell.factIds);
      }
    }
  }
  return ids.size;
}

export function countChecklistVerdicts(study: CanonicalStudy): { shown: number; notShown: number } {
  let shown = 0;
  let notShown = 0;
  for (const item of study.checklist ?? []) {
    if (SHOWN_VERDICTS.has(item.verdict)) shown += 1;
    else if (NOT_SHOWN_VERDICTS.has(item.verdict)) notShown += 1;
  }
  return { shown, notShown };
}

export function buildV5AcceptanceCounts(
  study: CanonicalStudy,
  packTitle: string | null = null,
): StudyRevisionAcceptanceCounts {
  const { shown, notShown } = countChecklistVerdicts(study);
  const documents = study.documents.length;
  const verifiedFacts = countVerifiedFactIds(study);
  const packRef = study.packRef;
  return {
    verifiedFacts,
    documents,
    ...(study.checklist && study.checklist.length > 0 ? { checklistShown: shown, checklistNotShown: notShown } : {}),
    ...(packRef && packTitle
      ? { packReview: { id: packRef.id, version: packRef.version, title: packTitle } }
      : packRef
        ? { packReview: { id: packRef.id, version: packRef.version, title: packRef.id } }
        : {}),
  };
}

function parsePackReview(value: unknown): StudyRevisionAcceptanceCounts["packReview"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.version !== "number") return undefined;
  return { id: row.id, version: row.version, title: row.title };
}

export function parseStudyRevisionAcceptanceCounts(raw: unknown): StudyRevisionAcceptanceCounts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const verifiedFacts = record.verifiedFacts;
  const documents = record.documents;
  if (typeof verifiedFacts !== "number" || typeof documents !== "number") return null;
  const checklistShown = typeof record.checklistShown === "number" ? record.checklistShown : undefined;
  const checklistNotShown = typeof record.checklistNotShown === "number" ? record.checklistNotShown : undefined;
  const packReview = parsePackReview(record.packReview);
  return {
    verifiedFacts,
    documents,
    ...(checklistShown !== undefined ? { checklistShown } : {}),
    ...(checklistNotShown !== undefined ? { checklistNotShown } : {}),
    ...(packReview ? { packReview } : {}),
  };
}

function factLabel(count: number): string {
  return `${count} verified ${count === 1 ? "fact" : "facts"}`;
}

function documentLabel(count: number): string {
  return `${count} ${count === 1 ? "document" : "documents"}`;
}

/** Owner-facing acceptance detail lines (brand voice, no V4 investigation jargon). */
export function formatStudyRevisionAcceptanceDetail(revision: StudyRevisionSummary): string {
  if (revision.format === "canonical-study-1" && revision.acceptanceCounts) {
    const { verifiedFacts, documents, checklistShown, checklistNotShown, packReview } = revision.acceptanceCounts;
    const parts = [factLabel(verifiedFacts), documentLabel(documents)];
    if (
      typeof checklistShown === "number" &&
      typeof checklistNotShown === "number" &&
      checklistShown + checklistNotShown > 0
    ) {
      parts.push(
        `${checklistShown} checks shown · ${checklistNotShown} not shown`,
      );
    }
    let text = parts.join(" · ");
    if (packReview) {
      text += `. Reviewed with: ${packReview.title} (v${packReview.version})`;
    }
    return text;
  }
  const sources = revision.sourceCount ?? 0;
  const findings = revision.documentFindingCount ?? 0;
  return `${documentLabel(sources).replace(/documents?$/, sources === 1 ? "source" : "sources")} · ${findings} verified ${findings === 1 ? "claim" : "claims"}`;
}

export function studyRevisionAcceptanceSubtext(
  format: StudyRevisionFormat | undefined,
  preparationMode: ProcessingRun["preparationMode"] | undefined,
): string {
  if (preparationMode === "REBUILD") {
    return "A new study revision was accepted from your saved pages. Earlier revisions and their reports stay as they are.";
  }
  if (format === "canonical-study-1") {
    return "Your study is ready. Reports are being written from the same verified facts.";
  }
  return "Every claim was checked against its page. Your reports are being written.";
}
