import type { GetStudyPreparationResponse, StudyView } from "@hiveforyou/contracts";

import { documentPageCounts } from "./hive-summary";

export type DocumentsReadCount = {
  readonly read: number;
  readonly total: number;
};

/** Documents that have been read, out of every document on the preparation. */
export function documentsReadCount(preparation: GetStudyPreparationResponse): DocumentsReadCount {
  const read = Object.keys(documentPageCounts(preparation)).length;
  const total = read + preparation.eligibility.excluded.length;
  return { read, total };
}

export function documentsReadLabel(count: DocumentsReadCount): string {
  return `${count.read} of ${count.total}`;
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