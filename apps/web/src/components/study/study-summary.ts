import type { CoverageGap, StudyView, StudyViewBlockName, StudyViewRow } from "@hiveforyou/contracts";

import { shortDocumentLabels } from "./document-labels";
import { documentsToRequestCount, groupMissing } from "./missing-groups";
import { readProblemsFromCoverage } from "./ReadProblemNotice";
import { countStates, type StateCounts } from "./StateBar";
import type { DisplayState } from "./StatusBadge";

export const STUDY_SECTION_IDS = {
  glance: "at-a-glance",
  disagree: "where-documents-disagree",
  establish: "what-documents-establish",
  missing: "what-is-missing",
  timeline: "timeline",
  documents: "documents",
} as const;

const blockRows = (view: StudyView, name: StudyViewBlockName): readonly StudyViewRow[] =>
  view.blocks.find((block) => block.name === name)?.rows ?? [];

/** The same counts the report's state bar shows, for headers and cards outside the report. */
export function studyStateCounts(view: StudyView, coverageGaps: readonly CoverageGap[]): StateCounts {
  const missing = groupMissing(blockRows(view, "gaps"), readProblemsFromCoverage(coverageGaps, () => undefined), view.spineSource);
  return countStates(blockRows(view, "spine_table"), documentsToRequestCount(missing));
}

/** The section each state-bar pill opens. */
export function studyStateTargets(view: StudyView): Record<DisplayState, string> {
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
