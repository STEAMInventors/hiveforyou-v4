"use client";

import {
  buildDocumentsLibraryRows,
  type DocumentsLibraryRow,
  type SourceDocument,
  type StudyView,
  type StudyViewRow,
} from "@hiveforyou/contracts";
import { useMemo, type ReactNode } from "react";

import { documentRoleLabel, latestChainPosition } from "@/components/study/DocumentsTable";
import { useEvidenceViewer } from "@/components/study/EvidenceViewer";
import { Section } from "@/components/ui/Section";
import { StatusDot } from "@/components/ui/StatusDot";
import type { StudyDocumentMeta } from "@/components/study/study-summary";

import type { DocumentsLibraryReadMetrics } from "./documents-library-metrics";

const NOTICE =
  "Reading a page isn't the same as proving what it says. Unreadable pages and gaps stay visible.";

function readCell(row: DocumentsLibraryRow, onRetry?: () => void): ReactNode {
  switch (row.readState) {
    case "pages-read":
      return <StatusDot state="checked" label="Read" />;
    case "partial":
      return (
        <StatusDot
          state="missing"
          label={row.partialPercent != null ? `${row.partialPercent}% read` : "Partly read"}
        />
      );
    case "duplicate":
      return <StatusDot state="changed" label="Duplicate" />;
    case "reading":
      return <span className="text-meta font-semibold text-ink-2">Reading…</span>;
    case "failed":
      return (
        <div className="flex flex-col items-end gap-1 min-[760px]:items-start">
          <StatusDot state="missing" label="Not read yet" />
          {onRetry ? (
            <button
              type="button"
              className="text-meta font-semibold text-blue-deep hover:underline"
              onClick={(event) => {
                event.stopPropagation();
                onRetry();
              }}
            >
              Try again
            </button>
          ) : null}
        </div>
      );
    case "unreadable":
      return <StatusDot state="missing" label="Not read yet" />;
  }
}

function flagsForRow(row: DocumentsLibraryRow, studyRow: StudyViewRow | undefined): string {
  const parts: string[] = [];
  const type = row.typeLine?.trim() || studyRow?.typeInPlainWords?.trim();
  if (type) parts.push(type);
  if (row.readState === "duplicate" && row.duplicateOfFileName) {
    parts.push(`Duplicate of ${row.duplicateOfFileName}`);
  } else if (row.readDetail) {
    parts.push(row.readDetail);
  }
  return parts.join(" · ");
}

type DocumentsSourceLibraryProps = {
  documents: readonly SourceDocument[];
  documentMeta: Readonly<Record<string, StudyDocumentMeta>>;
  studyView: StudyView | null;
  metrics: DocumentsLibraryReadMetrics;
  readingInProgress: boolean;
  onRetryRead?: (sourceDocumentId: string) => void;
  toolbar?: ReactNode;
};

export function DocumentsSourceLibrary({
  documents,
  documentMeta,
  studyView,
  metrics,
  readingInProgress,
  onRetryRead,
  toolbar,
}: DocumentsSourceLibraryProps) {
  const evidence = useEvidenceViewer();

  const rows = useMemo(
    () =>
      buildDocumentsLibraryRows({
        documents,
        documentMeta,
        studyView,
        pageCounts: metrics.pageCounts,
        verifiedPages: metrics.verifiedPages,
        unreadableFirstPage: metrics.unreadableFirstPage,
        readingInProgress,
      }),
    [documents, documentMeta, studyView, metrics, readingInProgress],
  );

  const studyRows = studyView?.blocks.find((block) => block.name === "documents")?.rows ?? [];
  const rowById = useMemo(() => new Map(studyRows.map((row) => [row.id.toLowerCase(), row])), [studyRows]);
  const latestChain = latestChainPosition(studyRows);
  const unreadableIds = useMemo(
    () =>
      new Set(
        documents
          .filter((document) => document.readStatus === "UNREADABLE" || document.readStatus === "FAILED")
          .map((document) => document.sourceDocumentId.toLowerCase()),
      ),
    [documents],
  );

  const pageTotal = rows.reduce((sum, row) => sum + (row.pageCount ?? 0), 0);

  const openRow = (row: DocumentsLibraryRow, trigger: HTMLElement) => {
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

  if (documents.length === 0) return null;

  return (
    <Section
      tone="blue"
      title="Uploaded"
      headingRight={
        <>
          {documents.length} {documents.length === 1 ? "file" : "files"}
          {pageTotal > 0 ? ` · ${pageTotal} pages` : ""}
        </>
      }
    >
      {toolbar ? <div className="mb-3 flex flex-wrap items-center gap-2">{toolbar}</div> : null}

      <div className="max-[759px]:flex max-[759px]:flex-col max-[759px]:gap-0 min-[760px]:overflow-x-auto" role="region" aria-label="Uploaded documents">
        <table className="w-full min-w-[640px] border-collapse max-[759px]:hidden" data-testid="source-library-table">
          <thead>
            <tr className="border-b border-line text-left text-meta font-semibold text-ink-3">
              <th scope="col" className="pb-2 pr-3">
                Document
              </th>
              <th scope="col" className="pb-2 pr-3">
                Period
              </th>
              <th scope="col" className="pb-2 pr-3 text-right tabular-nums">
                Pages
              </th>
              <th scope="col" className="pb-2">
                Read
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const studyRow = rowById.get(row.sourceDocumentId.toLowerCase());
              const role = studyRow
                ? documentRoleLabel(studyRow, latestChain, unreadableIds.has(row.sourceDocumentId.toLowerCase()))
                : row.titleLine;
              const sub = flagsForRow(row, studyRow);
              return (
                <tr
                  key={row.sourceDocumentId}
                  className="cursor-pointer border-b border-line transition-colors hover:bg-hover"
                  data-testid="source-library-row"
                  onClick={(event) => openRow(row, event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openRow(row, event.currentTarget);
                    }
                  }}
                  tabIndex={0}
                >
                  <th scope="row" className="py-3.5 pr-3 text-left">
                    <p className="m-0 text-body font-semibold text-ink">{role}</p>
                    {sub ? <p className="m-0 text-meta text-ink-3">{sub}</p> : null}
                  </th>
                  <td className="py-3.5 pr-3 whitespace-nowrap text-body text-ink-2">{row.periodLabel}</td>
                  <td className="py-3.5 pr-3 text-right tabular-nums text-body text-ink-2">{row.pageCount ?? "—"}</td>
                  <td className="py-3.5">{readCell(row, onRetryRead ? () => onRetryRead(row.sourceDocumentId) : undefined)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="min-[760px]:hidden">
          {rows.map((row) => {
            const studyRow = rowById.get(row.sourceDocumentId.toLowerCase());
            const role = studyRow
              ? documentRoleLabel(studyRow, latestChain, unreadableIds.has(row.sourceDocumentId.toLowerCase()))
              : row.titleLine;
            const sub = flagsForRow(row, studyRow);
            return (
              <button
                key={row.sourceDocumentId}
                type="button"
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-line py-3.5 text-left"
                data-testid="source-library-row-mobile"
                onClick={(event) => openRow(row, event.currentTarget)}
              >
                <span className="col-span-2 text-body font-semibold text-ink">{role}</span>
                {sub ? <span className="col-span-2 text-meta text-ink-3">{sub}</span> : null}
                <span className="text-meta text-ink-3">
                  {row.periodLabel}
                  {row.pageCount != null ? ` · ${row.pageCount} pages` : ""}
                </span>
                <span>{readCell(row)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="m-0 mt-4 text-meta text-ink-2" data-testid="source-library-notice">
        {NOTICE}
      </p>
    </Section>
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