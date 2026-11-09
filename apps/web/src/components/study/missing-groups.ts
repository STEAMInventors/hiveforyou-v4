import type { SpineSource, StudyViewRow } from "@hiveforyou/contracts";

import type { ReadProblem } from "./ReadProblemNotice";

const NO_ANCHOR_SPINE_SOURCES: ReadonlySet<SpineSource> = new Set(["TIMELINE", "PARTIES_AND_OBLIGATIONS"]);

/**
 * Without an anchor document, the canonical study's first gap says so and names the spine source
 * it used. That is a note about how the study is organised, not something missing.
 */
export function isStructuralNote(row: StudyViewRow, index: number, spineSource: SpineSource | null | undefined): boolean {
  return (
    index === 0 &&
    !!spineSource &&
    NO_ANCHOR_SPINE_SOURCES.has(spineSource) &&
    (row.relatedSpineIds?.length ?? 0) === 0
  );
}

export type MissingGroups = {
  readonly unreadable: readonly ReadProblem[];
  readonly referenced: readonly StudyViewRow[];
  readonly expected: readonly StudyViewRow[];
};

/** Unreadable pages, documents referred to but not supplied (with the referring page), then the rest. */
export function groupMissing(
  gapRows: readonly StudyViewRow[],
  readProblems: readonly ReadProblem[],
  spineSource: SpineSource | null | undefined,
): MissingGroups {
  const gaps = gapRows.filter((row, index) => !isStructuralNote(row, index, spineSource));
  return {
    unreadable: readProblems,
    referenced: gaps.filter((row) => (row.referencedBy?.length ?? 0) > 0),
    expected: gaps.filter((row) => (row.referencedBy?.length ?? 0) === 0),
  };
}

const NON_REQUESTABLE_GAP =
  /\b(?:confirmation hearing|court ruling|will be held|hearing on confirmation|trial date|scheduled hearing)\b/i;
const PROCESSING_ONLY_GAP =
  /\b(?:not among the documents, so .+ cannot be checked|pages? (?:were|was)n't read|could not be fully extracted|not included —)\b/i;

/** Gaps that name a document a client or party can supply, not future court events or processing limits. */
export function isRequestableDocumentGap(row: StudyViewRow): boolean {
  const statement = row.statement?.trim() ?? "";
  if (!statement) return false;
  if (NON_REQUESTABLE_GAP.test(statement)) return false;
  if (PROCESSING_ONLY_GAP.test(statement)) return false;
  return true;
}

export function documentsToRequestCount(groups: MissingGroups): number {
  let count = 0;
  for (const row of groups.referenced) if (isRequestableDocumentGap(row)) count += 1;
  for (const row of groups.expected) if (isRequestableDocumentGap(row)) count += 1;
  return count;
}

export function missingCount(groups: MissingGroups): number {
  return groups.unreadable.length + groups.referenced.length + groups.expected.length;
}
