import type { CoverageGap, StudyView, StudyViewBlockName, StudyViewRow } from "@hiveforyou/contracts";
import { DOCUMENT_REQUEST_LIST_COMPONENT } from "@hiveforyou/contracts";

import { shortDocumentLabels } from "./document-labels";
import { countStates, type StateCounts } from "./StateBar";

export const STUDY_SECTION_IDS = {
  glance: "at-a-glance",
  disagree: "where-documents-disagree",
  establish: "what-documents-establish",
  missing: "missing-documents",
  timeline: "timeline",
  documents: "documents",
} as const;

const blockRows = (view: StudyView, name: StudyViewBlockName): readonly StudyViewRow[] =>
  view.blocks.find((block) => block.name === name)?.rows ?? [];

/** Requestable documents only (not future records or unreadable files). */
export function studyDocumentRequestCount(view: StudyView): number {
  const component = view.components?.find((entry) => entry.name === DOCUMENT_REQUEST_LIST_COMPONENT);
  return (
    component?.items.filter((item) => item.kind === "REQUESTABLE_DOCUMENT" && item.holderType !== "COURT_RECORD").length ??
    0
  );
}

/** The same counts the report's state bar shows, for headers and cards outside the report. */
export function studyStateCounts(view: StudyView, coverageGaps: readonly CoverageGap[]): StateCounts {
  void coverageGaps;
  return countStates(blockRows(view, "spine_table"), studyDocumentRequestCount(view));
}

/** The section each state-bar pill opens. */
export function studyStateTargets(view: StudyView): Record<import("./StatusBadge").DisplayState, string> {
  const hasConflicts = blockRows(view, "conflicts").length > 0;
  return {
    needs: hasConflicts ? STUDY_SECTION_IDS.disagree : STUDY_SECTION_IDS.establish,
    missing: STUDY_SECTION_IDS.missing,
    changed: STUDY_SECTION_IDS.establish,
    checked: STUDY_SECTION_IDS.establish,
  };
}

export type StudyDocumentMeta = {
  readonly label: string;
  readonly typeInPlainWords: string | null;
  readonly date: string | null;
};

/** What the study says each document is, keyed by source document id. */
export function studyDocumentMeta(view: StudyView): Record<string, StudyDocumentMeta> {
  const documents = blockRows(view, "documents");
  const labels = shortDocumentLabels(
    documents.map((row) => ({ sourceDocumentId: row.id, typeInPlainWords: row.typeInPlainWords, date: row.date })),
  );
  return Object.fromEntries(
    documents.map((row) => [
      row.id.toLowerCase(),
      { label: labels.get(row.id) ?? "Document", typeInPlainWords: row.typeInPlainWords?.trim() || null, date: row.date ?? null },
    ]),
  );
}
