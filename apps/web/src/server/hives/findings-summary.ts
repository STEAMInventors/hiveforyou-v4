import type { GetStudyPreparationResponse, StudyView } from "@hiveforyou/contracts";

import { documentPageCounts } from "./hive-summary";

export type DocumentsReadCount = {
  readonly read: number;
  readonly total: number;
  /** Set only when the preparation payload already carries a duplicate count. */
  readonly duplicateCount: number | null;
};

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** Reads a duplicate count when one is already on the preparation. Does not derive one. */
export function preparationDuplicateCount(preparation: GetStudyPreparationResponse): number | null {
  const eligibility = preparation.eligibility as GetStudyPreparationResponse["eligibility"] & {
    duplicateCount?: unknown;
  };
  const onPreparation = (preparation as { duplicateCount?: unknown }).duplicateCount;
  return positiveInteger(eligibility.duplicateCount) ?? positiveInteger(onPreparation);
}

/** Documents that have been read, out of every document on the preparation. */
export function documentsReadCount(preparation: GetStudyPreparationResponse): DocumentsReadCount {
  const read = Object.keys(documentPageCounts(preparation)).length;
  const total = read + preparation.eligibility.excluded.length;
  return { read, total, duplicateCount: preparationDuplicateCount(preparation) };
}

export function documentsReadLabel(count: DocumentsReadCount): string {
  const base = `${count.read} of ${count.total}`;
  if (count.duplicateCount === null) return base;
  return `${base} · ${count.duplicateCount} duplicate`;
}

/** Rows in the current Study view. */
export function findingsItemCount(view: Pick<StudyView, "blocks">): number {
  return view.blocks.reduce((sum, block) => sum + block.rows.length, 0);
}

/** Items in the needs or changed state. */
export function findingsToReviewCount(
  counts: { readonly needs: number; readonly changed: number } | null | undefined,
): number {
  if (!counts) return 0;
  return counts.needs + counts.changed;
}
