"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { ComparisonCard } from "@/components/study/ComparisonCard";
import { EstablishTable } from "@/components/study/EstablishTable";
import type { EvidenceHighlightStatus, EvidencePdfPageProps } from "@/components/study/EvidencePdfPage";
import {
  type EvidenceStatementModel,
  type EvidenceStatementStatus,
} from "@/components/study/evidence-statement-model";
import { readProblemSentence, type ReadProblem } from "@/components/study/ReadProblemNotice";
import { type ChipRef } from "@/components/study/SourceChip";
import { Avatar } from "@/components/ui/AvatarStack";
import { StatusDot } from "@/components/ui/StatusDot";
import { useHiveChat } from "@/lib/hive-chat-context";
import { hiveHomePath } from "@/lib/hive-routes";
import { EVIDENCE_COMPOSE_PARAM } from "@/lib/hive-compose-query";

function statementStatus(state: EvidenceStatementStatus) {
  if (state === "unreadable") return <StatusDot state="missing" label="Page unreadable" />;
  if (state === "uncertain") return <StatusDot state="uncertain" label="Uncertain" />;
  return <StatusDot state="checked" label="Checked against the page" />;
}

function MetaBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="m-0 text-meta font-semibold text-ink-3">{title}</h4>
      {children}
    </div>
  );
}

type EvidenceViewPanelProps = {
  hiveId: string;
  backLabel: string;
  docRole: string;
  docSub: string | null;
  pageNumber: number;
  totalPages: number;
  statement: EvidenceStatementModel;
  chip: ChipRef;
  signedUrl: string | null;
  pageText: string | null;
  loadError: string | null;
  loadErrorCorrelationId?: string | null;
  pdfViewerLoadError: boolean;
  onRetry?: () => void;
  highlightStatusLine: string | null;
  quoteForHighlight: string;
  isPdf: boolean;
  isImage: boolean;
  PdfViewer: ComponentType<EvidencePdfPageProps> | null;
  neighborPageText: string | null;
  originalPageHref: string | undefined;
  onHighlightStatus: (status: EvidenceHighlightStatus) => void;
  onPageChange: (pageNumber: number) => void;
  onOpenChip: (chip: ChipRef) => void;
  onClose: () => void;
  showAskClient: boolean;
  clientFirstName: string | null;
  unreadableProblem: ReadProblem | null;
};

export function EvidenceViewPanel({
  hiveId,
  backLabel,
  docRole,
  docSub,
  pageNumber,
  totalPages,
  statement,
  chip,
  signedUrl,
  pageText,
  loadError,
  loadErrorCorrelationId = null,
  pdfViewerLoadError,
  onRetry,
  highlightStatusLine,
  quoteForHighlight,
  isPdf,
  isImage,
  PdfViewer,
  neighborPageText,
  originalPageHref,
  onHighlightStatus,
  onPageChange,
  onOpenChip,
  onClose,
  showAskClient,
  clientFirstName,
  unreadableProblem,
}: EvidenceViewPanelProps) {
  const askHref =
    statement.askClientQuestion && showAskClient
      ? `${hiveHomePath(hiveId)}?${EVIDENCE_COMPOSE_PARAM}=${encodeURIComponent(statement.askClientQuestion)}`
      : null;
  const clientLabel = clientFirstName?.trim() || "the client";
  const chat = useHiveChat();

  return (
    <section data-testid="evidence-viewer" className="mt-2 flex w-full flex-col gap-0 border-t border-line pt-2 min-[1100px]:flex-row">
      <div
        className="flex min-w-0 flex-1 flex-col gap-5 border-line py-6 pr-0 min-[1100px]:border-r min-[1100px]:py-8 min-[1100px]:pr-10"
        aria-label="The statement"
      >
        <Button type="button" variant="quiet" onClick={onClose}>
          ← Back to {backLabel}
        </Button>
        <p className="m-0 font-brand text-evidence font-normal text-ink">{statement.headline}</p>
        {statementStatus(statement.status)}
        {statement.whyItMatters ? (
          <MetaBlock title="Why it matters">
            <p className="m-0 text-body text-ink-2">{statement.whyItMatters}</p>
          </MetaBlock>
        ) : null}
        {statement.pageSupports ? (
          <MetaBlock title="What this page supports">
            <p className="m-0 whitespace-pre-wrap text-body text-ink-2">{statement.pageSupports}</p>
          </MetaBlock>
        ) : null}
        {statement.documentsDontSay ? (
          <MetaBlock title="What the documents don't say">
            <p className="m-0 text-body text-ink-2">{statement.documentsDontSay}</p>
          </MetaBlock>
        ) : null}
        {statement.pageButtons.length > 1 ? (
          <MetaBlock title="Pages behind this">
            <div className="flex flex-wrap gap-2" data-testid="evidence-page-buttons">
              {statement.pageButtons.map((button) => (
                <button
                  key={`${button.chip.sourceDocumentId}:${button.pageNumber}`}
                  type="button"
                  aria-current={button.current ? "page" : undefined}
                  className={`inline-flex min-h-10 flex-col items-start rounded-button border px-3 py-2 text-left text-[13px] ${
                    button.current ? "border-ink ring-1 ring-ink" : "border-line-strong bg-paper hover:bg-hover"
                  }`}
                  onClick={() => {
                    if (button.current) return;
                    onOpenChip(button.chip);
                  }}
                >
                  <span className="font-semibold text-ink">{button.label}</span>
                  <span className="text-meta tabular-nums text-ink-3">p.{button.pageNumber}</span>
                </button>
              ))}
            </div>
          </MetaBlock>
        ) : null}
        {statement.conflictRow ? (
          <ComparisonCard row={statement.conflictRow} documentDate={() => null} />
        ) : null}
        {statement.spineRow ? (
          <EstablishTable rows={[statement.spineRow]} compact={false} statusMode="spine" />
        ) : null}
        {statement.gapText ? (
          <p className="m-0 rounded-input border border-line bg-mist px-3 py-3 text-small text-ink-2">{statement.gapText}</p>
        ) : null}
        {askHref || chat?.assistantOn ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="evidence-ask-actions">
            {askHref ? (
              <Link
                href={askHref}
                className="inline-flex h-[34px] items-center text-[13.5px] font-semibold text-ink-2 no-underline hover:bg-hover max-[759px]:h-11"
                onClick={onClose}
              >
                Ask {clientLabel} about it
              </Link>
            ) : null}
            {chat?.assistantOn ? (
              <button
                type="button"
                data-testid="evidence-ask-assistant"
                className="inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-button border-0 bg-transparent px-1.5 text-[13.5px] font-semibold text-ink-2 hover:bg-hover max-[759px]:h-11"
                onClick={() => chat.openChat({ prefill: `About the ${docRole} page ${pageNumber}: ` })}
              >
                <Avatar person={{ id: "ai", name: chat.config.assistantName, kind: "assistant" }} size="xs" />
                Ask {chat.config.assistantName} about this page
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-4 bg-mist px-4 py-6 min-[1100px]:px-8 min-[1100px]:py-8" aria-label="Source page">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3 text-small text-ink-2">
          <span>
            <span className="font-semibold text-ink">{docRole}</span>
            {docSub ? ` · ${docSub}` : null}
          </span>
          <span className="tabular-nums text-ink-3">
            Page {pageNumber} of {totalPages}
          </span>
        </div>
        {loadError ? (
          <div
            role="alert"
            data-testid="evidence-load-error"
            className="mx-auto flex w-full max-w-[680px] flex-col gap-2 rounded-input border border-line bg-paper px-4 py-4"
          >
            <p className="m-0 text-small text-coral-deep">{loadError}</p>
            {loadErrorCorrelationId ? (
              <p className="m-0 text-caption text-ink-3" data-testid="evidence-load-error-correlation">
                Reference <span className="font-mono text-ink-2">{loadErrorCorrelationId}</span>
              </p>
            ) : null}
            {onRetry ? (
              <div className="pt-1">
                <Button type="button" variant="secondary" size="small" onClick={onRetry} data-testid="evidence-load-retry">
                  Try again
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {pdfViewerLoadError ? (
          <div
            role="alert"
            data-testid="evidence-pdf-viewer-load-error"
            className="mx-auto flex w-full max-w-[680px] flex-col gap-2 rounded-input border border-line bg-paper px-4 py-4"
          >
            <p className="m-0 text-small text-coral-deep">Could not load the PDF viewer.</p>
            {onRetry ? (
              <div className="pt-1">
                <Button type="button" variant="secondary" size="small" onClick={onRetry} data-testid="evidence-pdf-viewer-retry">
                  Try again
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {unreadableProblem ? (
          <div
            className="mx-auto w-full max-w-[680px] rounded-page bg-page-warm px-8 py-12 text-center text-body text-ink-2 shadow-lift"
            data-testid="evidence-unreadable"
          >
            {readProblemSentence(unreadableProblem)}
          </div>
        ) : null}
        {!unreadableProblem && highlightStatusLine && isPdf ? (
          <p className="m-0 text-small text-ink-3" data-testid="evidence-highlight-status">
            {highlightStatusLine}
          </p>
        ) : null}
        {!unreadableProblem && signedUrl && isPdf && PdfViewer ? (
          <div className="mx-auto w-full max-w-[680px] rounded-page bg-page-warm p-3 shadow-lift">
            <PdfViewer
              fileUrl={signedUrl}
              pageNumber={pageNumber}
              quote={quoteForHighlight}
              pageText={pageText}
              neighborPageText={neighborPageText}
              neighborPageNumber={pageNumber < totalPages ? pageNumber + 1 : undefined}
              onHighlightStatus={onHighlightStatus}
              originalPageHref={originalPageHref}
              onRetry={onRetry}
            />
          </div>
        ) : null}
        {!unreadableProblem && signedUrl && isPdf && !PdfViewer && !pdfViewerLoadError ? (
          <p className="m-0 text-small text-ink-3">Loading viewer…</p>
        ) : null}
        {!unreadableProblem && signedUrl && isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL from owner session
          <img
            src={signedUrl}
            alt=""
            className="mx-auto max-h-[min(70vh,720px)] w-full max-w-[680px] rounded-page bg-page-warm object-contain shadow-lift"
            data-testid="evidence-image-page"
          />
        ) : null}
        {!unreadableProblem && signedUrl && !isPdf && !isImage && pageText ? (
          <blockquote className="mx-auto m-0 max-h-[min(70vh,720px)] w-full max-w-[680px] overflow-y-auto whitespace-pre-wrap rounded-page border border-line bg-page-warm p-6 font-quote text-small text-ink shadow-lift">
            {pageText}
          </blockquote>
        ) : null}
        {!unreadableProblem && !signedUrl && !loadError ? <p className="m-0 text-small text-ink-3">Loading…</p> : null}
        {!unreadableProblem && quoteForHighlight.trim() !== "" && !isPdf && isImage && !!signedUrl ? (
          <p className="m-0 text-small text-ink-3" data-testid="evidence-quote-unlocated">
            The quote is on this page; its exact position couldn&apos;t be marked.
          </p>
        ) : null}
        {!unreadableProblem ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex h-10 min-w-[44px] items-center justify-center rounded-button border border-line-strong bg-paper px-3 text-small text-ink hover:bg-hover disabled:opacity-40"
              disabled={pageNumber <= 1}
              onClick={() => onPageChange(Math.max(1, pageNumber - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="inline-flex h-10 min-w-[44px] items-center justify-center rounded-button border border-line-strong bg-paper px-3 text-small text-ink hover:bg-hover disabled:opacity-40"
              disabled={pageNumber >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, pageNumber + 1))}
            >
              Next
            </button>
            {originalPageHref ? (
              <a
                href={originalPageHref}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-small text-ink-3 underline decoration-line underline-offset-2 hover:text-ink"
                data-testid="evidence-open-original"
              >
                Open the original
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}