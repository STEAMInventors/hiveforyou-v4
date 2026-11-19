import type { SourceDocument } from "../source-documents/source-document-contracts";
import type { StudyView, StudyViewRow } from "../pipeline/study-view-contracts";
import type { StudyDocumentMeta } from "./documents-library-types";

export type DocumentsLibraryFilter = "all" | "to-review" | "read";

export type DocumentReadState =
  | "pages-read"
  | "partial"
  | "duplicate"
  | "reading"
  | "failed"
  | "unreadable";

export type DocumentsLibraryRow = {
  readonly sourceDocumentId: string;
  readonly titleLine: string;
  readonly fileName: string;
  readonly typeLine: string | null;
  readonly periodLabel: string;
  readonly pageCount: number | null;
  readonly readState: DocumentReadState;
  readonly readDetail: string | null;
  readonly duplicateOfFileName: string | null;
  readonly partialPercent: number | null;
  readonly unreadablePage: number | null;
};

function blockRows(view: StudyView | null, name: string): readonly StudyViewRow[] {
  if (!view) return [];
  return view.blocks.find((block) => block.name === name)?.rows ?? [];
}

const fullDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function formatPeriod(meta: StudyDocumentMeta | undefined, row: StudyViewRow | undefined): string {
  const date = meta?.date ?? row?.date ?? null;
  if (!date) return "—";
  const parsed = Date.parse(date);
  if (Number.isNaN(parsed)) return date;
  return fullDate.format(new Date(parsed));
}

type SourceLibraryDocument = SourceDocument & { readonly contentFingerprint?: string | null; readonly pageCount?: number | null };

function shaIndex(documents: readonly SourceLibraryDocument[]): Map<string, string> {
  const first = new Map<string, string>();
  const sorted = [...documents].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const doc of sorted) {
    const digest = doc.contentFingerprint?.trim().toLowerCase();
    if (!digest) continue;
    if (!first.has(digest)) first.set(digest, doc.fileName);
  }
  return first;
}

export function documentReadState(
  document: SourceDocument,
  reading: boolean,
  duplicateOf: string | null,
  verifiedPages: number | null,
  totalPages: number | null,
  unreadablePage: number | null,
): { state: DocumentReadState; detail: string | null; partialPercent: number | null } {
  if (duplicateOf) {
    return { state: "duplicate", detail: `Same as ${duplicateOf}`, partialPercent: null };
  }
  if (document.readStatus === "PENDING") {
    return reading
      ? { state: "reading", detail: null, partialPercent: null }
      : { state: "partial", detail: null, partialPercent: null };
  }
  if (document.readStatus === "SUCCEEDED") {
    return { state: "pages-read", detail: null, partialPercent: 100 };
  }
  if (document.readStatus === "PARTIAL") {
    const pct =
      totalPages && verifiedPages != null && totalPages > 0 ? Math.round((verifiedPages / totalPages) * 100) : null;
    return {
      state: "partial",
      detail: unreadablePage != null ? `p.${unreadablePage} unreadable` : null,
      partialPercent: pct,
    };
  }
  if (document.readStatus === "FAILED") {
    return { state: "failed", detail: null, partialPercent: null };
  }
  return { state: "unreadable", detail: null, partialPercent: null };
}

export function buildDocumentsLibraryRows(input: {
  documents: readonly SourceLibraryDocument[];
  documentMeta: Readonly<Record<string, StudyDocumentMeta>>;
  studyView: StudyView | null;
  pageCounts: Readonly<Record<string, number>>;
  verifiedPages: Readonly<Record<string, number>>;
  unreadableFirstPage: Readonly<Record<string, number>>;
  readingInProgress: boolean;
}): DocumentsLibraryRow[] {
  const studyDocs = blockRows(input.studyView, "documents");
  const docRowById = new Map(studyDocs.map((row) => [row.id.toLowerCase(), row]));
  const dupIndex = shaIndex(input.documents);

  return input.documents.map((document) => {
    const key = document.sourceDocumentId.toLowerCase();
    const meta = input.documentMeta[key];
    const row = docRowById.get(key);
    const digest = document.contentFingerprint?.trim().toLowerCase() ?? "";
    const firstName = digest ? dupIndex.get(digest) : null;
    const duplicateOf =
      firstName && firstName !== document.fileName && document.readStatus === "SUCCEEDED" ? firstName : null;
    const total = input.pageCounts[document.sourceDocumentId] ?? document.pageCount ?? null;
    const verified = input.verifiedPages[document.sourceDocumentId] ?? null;
    const unreadablePage = input.unreadableFirstPage[document.sourceDocumentId] ?? null;
    const read = documentReadState(document, input.readingInProgress, duplicateOf, verified, total, unreadablePage);
    const titleLine =
      meta?.typeInPlainWords?.trim() ||
      row?.typeInPlainWords?.trim() ||
      (document.readStatus === "PENDING" ? "Not read yet" : meta?.label?.trim() || "Document");
    return {
      sourceDocumentId: document.sourceDocumentId,
      titleLine,
      fileName: document.fileName,
      typeLine: row?.typeInPlainWords?.trim() || meta?.typeInPlainWords?.trim() || null,
      periodLabel: formatPeriod(meta, row),
      pageCount: total,
      readState: read.state,
      readDetail: read.detail,
      duplicateOfFileName: duplicateOf,
      partialPercent: read.partialPercent,
      unreadablePage,
    };
  });
}

export function filterDocumentsLibraryRows(
  rows: readonly DocumentsLibraryRow[],
  filter: DocumentsLibraryFilter,
): DocumentsLibraryRow[] {
  switch (filter) {
    case "to-review":
      return rows.filter(
        (row) => row.readState === "partial" || row.readState === "failed" || row.readState === "unreadable",
      );
    case "read":
      return rows.filter((row) => row.readState === "pages-read");
    default:
      return [...rows];
  }
}