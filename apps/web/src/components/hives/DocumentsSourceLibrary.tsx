"use client";

import {
  buildDocumentsLibraryRows,
  filterDocumentsLibraryRows,
  type DocumentsLibraryFilter,
  type DocumentsLibraryRow,
} from "@hiveforyou/contracts";
import type { SourceDocument, StudyView } from "@hiveforyou/contracts";
import { useMemo, useState, type ReactNode } from "react";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import type { StudyDocumentMeta } from "@/components/study/study-summary";
import { StatusDot } from "@/components/workspace/StatusDot";
import { useEvidenceViewer } from "@/components/study/EvidenceViewer";

import { AddFilesButton } from "./SourceFilePicker";
import type { DocumentsLibraryReadMetrics } from "./documents-library-metrics";

const CARD = "rounded-[14px] border border-line bg-paper p-[22px]";
const NOTICE =
  "Reading a page is not the same as proving its statements true. Supporting evidence is verified against what the source says; gaps and unreadable pages remain visible.";

function readStateCell(row: DocumentsLibraryRow, onRetry?: () => void): ReactNode {
  switch (row.readState) {
    case "pages-read":
      return <StatusDot state="checked" label="Pages read" />;
    case "partial":
      return (
        <div className="flex flex-col gap-0.5">
          <StatusDot state="missing" label={row.partialPercent != null ? `${row.partialPercent}% read` : "Partly read"} />
          {row.readDetail ? <span className="text-[12px] text-coral-deep">{row.readDetail}</span> : null}
        </div>
      );
    case "duplicate":
      return (
        <div className="flex flex-col gap-0.5">
          <StatusDot state="changed" label="Duplicate" />
          {row.readDetail ? <span className="text-[12px] text-honey-deep">{row.readDetail}</span> : null}
        </div>
      );
    case "reading":
      return <span className="text-[12.5px] font-semibold text-graphite">Reading…</span>;
    case "failed":
      return (
        <div className="flex flex-col items-start gap-1">
          <StatusDot state="missing" label="Couldn't read" />
          {onRetry ? (
            <button type="button" className={`${WORKSPACE_SECONDARY} min-h-8 px-2 text-[12px]`} onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      );
    case "unreadable":
      return <StatusDot state="missing" label="Couldn't read" />;
  }
}

type DocumentsSourceLibraryProps = {
  documents: readonly SourceDocument[];
  documentMeta: Readonly<Record<string, StudyDocumentMeta>>;
  studyView: StudyView | null;
  metrics: DocumentsLibraryReadMetrics;
  readingInProgress: boolean;
  addDisabled: boolean;
  addDescribedBy?: string;
  onAddFiles: (files: File[]) => void;
  onRetryRead?: (sourceDocumentId: string) => void;
  toolbar?: ReactNode;
};

export function DocumentsSourceLibrary({
  documents,
  documentMeta,
  studyView,
  metrics,
  readingInProgress,
  addDisabled,
  addDescribedBy,
  onAddFiles,
  onRetryRead,
  toolbar,
}: DocumentsSourceLibraryProps) {
  const [filter, setFilter] = useState<DocumentsLibraryFilter>("all");
  const evidence = useEvidenceViewer();

  const rows = useMemo(
    () =>
      filterDocumentsLibraryRows(
        buildDocumentsLibraryRows({
          documents,
          documentMeta,
          studyView,
          pageCounts: metrics.pageCounts,
          verifiedPages: metrics.verifiedPages,
          unreadableFirstPage: metrics.unreadableFirstPage,
          readingInProgress,
        }),
        filter,
      ),
    [documents, documentMeta, studyView, metrics, readingInProgress, filter],
  );

  const openInspect = (row: DocumentsLibraryRow, trigger: HTMLElement) => {
    evidence.open(
      {
        sourceDocumentId: row.sourceDocumentId,
        pageNumber: 1,
        quote: "",
        factIds: [],
      },
      trigger,
    );
  };

  return (
    <section className={CARD} data-testid="source-library-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="m-0 font-brand text-[16px] font-semibold text-ink">Source library</h3>
          <p className="m-0 mt-1 text-small text-graphite">
            {documents.length} original {documents.length === 1 ? "file" : "files"}; file names are never used as evidence
            citations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="documents-library-filter">
            Filter documents
          </label>
          <select
            id="documents-library-filter"
            className="min-h-9 rounded-control border border-line bg-paper px-2 text-small text-ink"
            value={filter}
            onChange={(event) => setFilter(event.target.value as DocumentsLibraryFilter)}
            data-testid="documents-library-filter"
          >
            <option value="all">All documents</option>
            <option value="to-review">To review</option>
            <option value="read">Read completely</option>
          </select>
          <AddFilesButton
            showLabel
            label="Add files"
            disabled={addDisabled}
            describedBy={addDescribedBy}
            className={WORKSPACE_SECONDARY}
            onAdd={onAddFiles}
          />
        </div>
      </div>

      {toolbar ? <div className="mt-2 flex flex-wrap items-center gap-2">{toolbar}</div> : null}

      {documents.length === 0 ? null : (
        <div className="mt-4 overflow-x-auto" role="region" aria-label="Source library" tabIndex={0}>
          <table className="w-full min-w-[760px] border-collapse text-small" data-testid="source-library-table">
            <thead>
              <tr className="border-b border-line text-left text-caption font-semibold text-quiet">
                <th scope="col" className="pb-2 pr-3">
                  Document
                </th>
                <th scope="col" className="pb-2 pr-3">
                  Period / date
                </th>
                <th scope="col" className="pb-2 pr-3 text-right">
                  Pages
                </th>
                <th scope="col" className="pb-2 pr-3">
                  Read state
                </th>
                <th scope="col" className="pb-2">
                  <span className="sr-only">Inspect</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sourceDocumentId} className="border-b border-line" data-testid="source-library-row">
                  <th scope="row" className="py-3 pr-3 text-left font-medium text-ink">
                    <p className="m-0">{row.titleLine}</p>
                    <p className="m-0 text-[12px] text-quiet">{row.fileName}</p>
                  </th>
                  <td className="py-3 pr-3 whitespace-nowrap text-graphite">{row.periodLabel}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-graphite">{row.pageCount ?? "—"}</td>
                  <td className="py-3 pr-3">{readStateCell(row, onRetryRead ? () => onRetryRead(row.sourceDocumentId) : undefined)}</td>
                  <td className="py-3">
                    <button
                      type="button"
                      className={`${WORKSPACE_SECONDARY} min-h-9 px-3 text-[13px]`}
                      onClick={(event) => openInspect(row, event.currentTarget)}
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="m-0 mt-4 text-small text-graphite" data-testid="source-library-notice">
        {NOTICE}
      </p>
    </section>
  );
}

/** Builds coverage subtitle lines for the evidence viewer header when inspecting from the library. */
export function libraryEvidenceCoverageLines(
  documents: readonly SourceDocument[],
  metrics: DocumentsLibraryReadMetrics,
): ReadonlyMap<string, string> {
  const lines = new Map<string, string>();
  for (const document of documents) {
    const line = metrics.coverageLineFor(document.sourceDocumentId);
    if (line) lines.set(document.sourceDocumentId, line);
    if (line) lines.set(document.sourceDocumentId.toLowerCase(), line);
  }
  return lines;
}