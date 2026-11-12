import type { CanonicalStudy } from "./canonical-study-contracts";
import type { SnapshotDocument } from "../study-preparation/study-preparation-contracts";
import type { GapUploadLink } from "./missing-documents";

/** Normalized gap title for cross-revision matching (ids Xn are not stable). */
export function normalizeGapTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export type GapFillLink = {
  readonly sourceDocumentId: string;
  readonly studyRevisionId: string;
  readonly gapId: string;
  readonly gapTitle: string;
};

type GapLinkFields = {
  readonly id?: string;
  readonly canonicalGapId?: string | null;
  readonly canonicalGapStudyRevisionId?: string | null;
  readonly canonicalGapTitle?: string | null;
};

function readGapFillLink(document: GapLinkFields): GapFillLink | null {
  const gapId = typeof document.canonicalGapId === "string" ? document.canonicalGapId.trim() : "";
  const gapTitle = typeof document.canonicalGapTitle === "string" ? document.canonicalGapTitle.trim() : "";
  const studyRevisionId =
    typeof document.canonicalGapStudyRevisionId === "string" ? document.canonicalGapStudyRevisionId.trim().toLowerCase() : "";
  const sourceDocumentId = typeof document.id === "string" ? document.id.trim().toLowerCase() : "";
  if (gapId === "" || gapTitle === "" || studyRevisionId === "" || sourceDocumentId === "") return null;
  if (!/^X\d+$/.test(gapId)) return null;
  return { sourceDocumentId, studyRevisionId, gapId, gapTitle };
}

export function parseGapFillLinks(documents: readonly GapLinkFields[]): GapFillLink[] {
  const links: GapFillLink[] = [];
  for (const document of documents) {
    const link = readGapFillLink(document);
    if (link) links.push(link);
  }
  return links;
}

export function gapFillLinksFromSnapshot(documents: readonly SnapshotDocument[]): GapFillLink[] {
  return parseGapFillLinks(
    documents.map((document) => ({
      id: document.sourceDocumentId,
      canonicalGapId: document.canonicalGapId ?? null,
      canonicalGapStudyRevisionId: document.canonicalGapStudyRevisionId ?? null,
      canonicalGapTitle: document.canonicalGapTitle ?? null,
    })),
  );
}

export function filledGapTitles(links: readonly GapFillLink[]): Set<string> {
  return new Set(links.map((link) => normalizeGapTitle(link.gapTitle)).filter((title) => title !== ""));
}

/** Remove gaps whose title matches an uploaded slot fill (never match by gap id across revisions). */
export function dropGapsFilledByUpload(study: CanonicalStudy, filledTitles: ReadonlySet<string>): CanonicalStudy {
  if (filledTitles.size === 0) return study;
  const gaps = study.gaps.filter((gap) => {
    const title = gap.title.trim() !== "" ? gap.title : gap.statement;
    if (!title) return true;
    return !filledTitles.has(normalizeGapTitle(title));
  });
  return { ...study, gaps };
}

/**
 * Whether a stored upload link belongs to a missing-document slot on the current accepted study.
 * Same revision: match gap id. Across revisions: normalized title only — never bare id.
 */
export function gapUploadMatchesSlot(
  link: GapUploadLink,
  slot: { readonly gapId: string; readonly title: string },
  acceptedStudyRevisionId: string | null,
): boolean {
  const slotTitle = normalizeGapTitle(slot.title);
  const linkTitle = link.gapTitle?.trim() ? normalizeGapTitle(link.gapTitle) : "";
  if (linkTitle !== "" && linkTitle === slotTitle) return true;
  const revisionId = link.studyRevisionId?.trim().toLowerCase() ?? "";
  const accepted = acceptedStudyRevisionId?.trim().toLowerCase() ?? "";
  if (revisionId !== "" && accepted !== "" && revisionId === accepted && link.gapId === slot.gapId) return true;
  return false;
}
