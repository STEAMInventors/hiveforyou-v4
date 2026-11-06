"use client";

import { type SourceDocument, type UploadQuota } from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";

import { PRIMARY_BUTTON_CLASS, QUIET_LINK_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import type { DisplayState } from "@/components/study/StatusBadge";
import { StatusBadge } from "@/components/study/StatusBadge";
import type { StudyDocumentMeta } from "@/components/study/study-summary";
import { formatDocumentDate } from "@/components/study/Timeline";
import { hiveReportsPath, hiveStudyPath, sourcePagePath } from "@/lib/hive-routes";
import { HiveClientError } from "@/lib/hives-client";
import { fetchSourceDocuments, fetchUploadQuota } from "@/lib/source-documents-client";

import { AnalyzeModal } from "./AnalyzeModal";
import { analyzeHint, rebuildHint } from "./study-preparation-progress";
import { AddFilesButton, SelectedFileList } from "./SourceFilePicker";
import {
  MAX_FILES_PER_BATCH,
  rejectionMessage,
  toSelectedSourceFiles,
  uploadSelectedSourceFiles,
  type SelectedSourceFile,
} from "./source-file-upload";
import { useStudyPreparation } from "./useStudyPreparation";

type LoadError = { message: string; correlationId: string | null };

type DocumentsPanelProps = {
  hiveId: string;
  initialDocuments: SourceDocument[];
  initialError?: LoadError | null;
  onNavigateToReports?: () => void;
  /** What the current study says each document is, keyed by lowercase source document id. */
  documentMeta?: Readonly<Record<string, StudyDocumentMeta>>;
};

const TYPE_IN_PLAIN_WORDS: Record<SourceDocument["mimeType"], string> = {
  "application/pdf": "PDF document",
  "image/png": "Image",
  "image/jpeg": "Image",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const READ_STATUS_DETAIL: Record<SourceDocument["readStatus"], string> = {
  PENDING: "Not read yet. Analyze reads it first.",
  SUCCEEDED: "Every page is saved and checked.",
  PARTIAL: "Some pages had no readable text.",
  UNREADABLE: "No readable text was found.",
  FAILED: "Reading didn't finish. Analyze tries again.",
};

type RowStatus = { state: DisplayState | "neutral"; label: string; detail: string };

/** Upload and read states in brand states; work in progress is neutral, never a brand colour. */
export function documentRowStatus(document: SourceDocument, reading: boolean): RowStatus {
  if (document.status === "REJECTED") return { state: "missing", label: "Not accepted", detail: rejectionMessage(document) };
  if (document.status === "PENDING") {
    return { state: "needs", label: "Needs you", detail: "The upload didn't finish. Add this file again." };
  }
  switch (document.readStatus) {
    case "PENDING":
      return reading
        ? { state: "neutral", label: "Reading", detail: "Reading your documents. This usually takes a few minutes." }
        : { state: "neutral", label: "Not read yet", detail: READ_STATUS_DETAIL.PENDING };
    case "SUCCEEDED":
      return { state: "checked", label: "Checked", detail: READ_STATUS_DETAIL.SUCCEEDED };
    case "PARTIAL":
    case "FAILED":
      return { state: "needs", label: "Needs you", detail: READ_STATUS_DETAIL[document.readStatus] };
    case "UNREADABLE":
      return { state: "missing", label: "Missing", detail: READ_STATUS_DETAIL.UNREADABLE };
  }
}

function toLoadError(error: unknown, fallback: string): LoadError {
  return error instanceof HiveClientError
    ? { message: error.message, correlationId: error.correlationId || null }
    : { message: fallback, correlationId: null };
}

const CARD = "flex flex-col rounded-card border border-line bg-paper p-5 sm:p-7";

type DocumentRowProps = {
  hiveId: string;
  document: SourceDocument;
  label: string;
  meta: StudyDocumentMeta | undefined;
  pages: number | undefined;
  status: RowStatus;
};

function DocumentRow({ hiveId, document, label, meta, pages, status }: DocumentRowProps) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const date = formatDocumentDate(meta?.date ?? null);
  const facts = [
    meta?.typeInPlainWords ?? TYPE_IN_PLAIN_WORDS[document.mimeType],
    date,
    pages ? `${pages} ${pages === 1 ? "page" : "pages"}` : null,
  ].filter((fact): fact is string => !!fact);
  const readable = document.readStatus === "SUCCEEDED" || document.readStatus === "PARTIAL";

  return (
    <li className="flex flex-col border-t border-line first:border-t-0" data-testid="document-row">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
        <div className="min-w-0 flex-[1_1_220px]">
          <p className="m-0 font-brand text-[16px] font-medium text-ink">{label}</p>
          <p className="m-0 text-small text-graphite">{facts.join(" · ")}</p>
        </div>
        <StatusBadge state={status.state} label={status.label} />
        <button
          type="button"
          className={QUIET_LINK_CLASS}
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "Open"}
          <span className="sr-only"> {label}</span>
        </button>
      </div>
      {open ? (
        <div id={detailId} className="mb-4 flex flex-col gap-2 rounded-control bg-mist p-4 text-small text-graphite">
          <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[120px_minmax(0,1fr)]">
            <dt className="text-quiet">File name</dt>
            <dd className="m-0 break-words text-ink">{document.fileName}</dd>
            <dt className="text-quiet">Status</dt>
            <dd className="m-0">{status.detail}</dd>
            <dt className="text-quiet">Added</dt>
            <dd className="m-0">{dateFormat.format(new Date(document.createdAt))}</dd>
          </dl>
          {readable ? (
            <a
              href={sourcePagePath(hiveId, document.sourceDocumentId, 1)}
              target="_blank"
              rel="noreferrer"
              className={QUIET_LINK_CLASS}
            >
              Open the original
            </a>
          ) : null}
        </div>
      ) : (
        <div id={detailId} hidden />
      )}
    </li>
  );
}

export function DocumentsPanel({
  hiveId,
  initialDocuments,
  initialError = null,
  onNavigateToReports,
  documentMeta = {},
}: DocumentsPanelProps) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [loadError, setLoadError] = useState<LoadError | null>(initialError);
  const [quota, setQuota] = useState<UploadQuota | null>(null);
  const [batch, setBatch] = useState<SelectedSourceFile[]>([]);
  const [busy, setBusy] = useState(false);

  const navigateToReports = useCallback(() => {
    if (onNavigateToReports) {
      onNavigateToReports();
      return;
    }
    router.push(hiveReportsPath(hiveId));
  }, [hiveId, onNavigateToReports, router]);

  const refresh = useCallback(async () => {
    try {
      const [list, quotaResponse] = await Promise.all([
        fetchSourceDocuments(hiveId),
        fetchUploadQuota(),
      ]);
      setDocuments(list.sourceDocuments);
      setQuota(quotaResponse.quota);
      setLoadError(null);
    } catch (error) {
      setLoadError(toLoadError(error, "Could not load your documents."));
    }
  }, [hiveId]);

  useEffect(() => {
    void fetchUploadQuota()
      .then((response) => setQuota(response.quota))
      .catch(() => setQuota(null));
  }, []);

  const analysis = useStudyPreparation(hiveId, { onReportsReady: navigateToReports });
  const refreshAnalysis = analysis.refresh;
  const analysisStatus = analysis.run?.status ?? null;
  useEffect(() => {
    if (analysisStatus) void refresh();
  }, [analysisStatus, refresh]);
  const toRead = analysis.toRead.length;
  const analyzeDisabled = !analysis.availability?.canAnalyze || analysis.starting || busy;
  const acceptedRebuild =
    analysis.run?.preparationMode === "REBUILD" &&
    analysis.run.status === "SUCCEEDED" &&
    analysis.state?.studyRevision?.processingRunId === analysis.run.id
      ? analysis.state.studyRevision
      : null;
  const showRebuild = analysis.state?.studyRevision != null && !analysis.active;
  const analyzeIsPrimary = documents.length > 0 && !!analysis.availability?.canAnalyze && !analysis.active;
  const pagesById = new Map(
    (analysis.state?.eligibility.documents ?? []).map((document) => [document.sourceDocumentId.toLowerCase(), document.totalPhysicalPages]),
  );

  const addFiles = async (picked: File[]) => {
    const selected = toSelectedSourceFiles(picked).slice(0, MAX_FILES_PER_BATCH);
    setBatch(selected);
    setBusy(true);
    try {
      await uploadSelectedSourceFiles(hiveId, selected, (key, patch) =>
        setBatch((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item))),
      );
      await refresh();
      void refreshAnalysis();
    } finally {
      setBusy(false);
    }
  };

  const remaining = quota?.remaining ?? null;
  const addDisabled = busy || remaining === 0;
  const quotaText =
    remaining === null
      ? "PDF, PNG, JPG or DOCX, up to 25 MB each."
      : remaining === 0
        ? "You've used this month's free uploads. Your allowance resets on the 1st (UTC)."
        : `PDF, PNG, JPG or DOCX, up to 25 MB each. ${remaining} of ${quota?.limit} free uploads left this month.`;

  let unlabelled = 0;

  return (
    <section aria-labelledby="documents-title" className="flex flex-col gap-5">
      <h2 id="documents-title" className="sr-only">
        Documents
      </h2>

      <div
        className="flex flex-col items-start gap-3 rounded-card border-2 border-dashed border-line bg-paper p-5 sm:p-7"
        data-testid="upload-card"
      >
        {!loadError && documents.length === 0 ? (
          <h3 className="m-0 font-brand text-section font-semibold text-ink">Upload whatever you have to start your hive.</h3>
        ) : null}
        <p className="m-0 max-w-prose text-body text-graphite">
          Upload whatever you have — old, partial or out of order is fine.
        </p>
        <AddFilesButton
          showLabel
          label="Add documents"
          disabled={addDisabled}
          describedBy="documents-quota"
          className={analyzeIsPrimary ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
          onAdd={(picked) => void addFiles(picked)}
        />
        <p id="documents-quota" className="m-0 text-[13px] text-quiet" aria-live="polite">
          {quotaText}
        </p>
      </div>

      <SelectedFileList files={batch} label="Uploading documents" busy />

      {acceptedRebuild ? (
        <div role="status" data-testid="rebuild-study-status" className={`${CARD} gap-1 text-small text-ink`}>
          <p className="m-0 font-medium">Study revision {acceptedRebuild.revisionNumber} accepted.</p>
          <p className="m-0 text-graphite">
            {acceptedRebuild.sourceCount ?? 0} sources · {acceptedRebuild.documentFindingCount ?? 0} atomic document findings.
            Reading every saved page does not mean every fact was extracted.
          </p>
          <Link href={hiveStudyPath(hiveId)} className={QUIET_LINK_CLASS} data-testid="rebuild-study-link">
            Open study revision {acceptedRebuild.revisionNumber}
          </Link>
        </div>
      ) : null}

      {analysis.startError && !analysis.modalMode ? (
        <div role="alert" className={`${CARD} gap-1 text-small text-missing-fg`}>
          {analysis.startError.message}
          {analysis.startError.correlationId ? (
            <span className="block font-mono text-[12px] text-quiet">
              Support reference: {analysis.startError.correlationId}
            </span>
          ) : null}
        </div>
      ) : null}

      {loadError ? (
        <div role="alert" className={`${CARD} items-start gap-2`}>
          <p className="m-0 text-body text-ink">{loadError.message}</p>
          {loadError.correlationId ? (
            <p className="m-0 font-mono text-[12px] text-quiet">Support reference: {loadError.correlationId}</p>
          ) : null}
          <button type="button" className={`${SECONDARY_BUTTON_CLASS} mt-2`} onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      ) : null}

      {documents.length > 0 ? (
        <div className={`${CARD} gap-3`} data-testid="documents-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="m-0 font-brand text-section font-semibold text-ink">
              {documents.length} {documents.length === 1 ? "document" : "documents"}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {analysis.active ? (
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS}
                  onClick={(event) => {
                    analysis.returnFocusRef.current = event.currentTarget;
                    analysis.openModal();
                  }}
                >
                  {analysis.awaiting ? "Review missing content" : "Show analysis progress"}
                </button>
              ) : (
                <button
                  type="button"
                  className={analyzeIsPrimary ? PRIMARY_BUTTON_CLASS : SECONDARY_BUTTON_CLASS}
                  disabled={analyzeDisabled}
                  aria-describedby="documents-analyze-hint"
                  data-testid="analyze-button"
                  onClick={(event) => {
                    analysis.returnFocusRef.current = event.currentTarget;
                    analysis.analyze();
                  }}
                >
                  {analysis.starting ? "Starting…" : "Analyze"}
                </button>
              )}
              {showRebuild ? (
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS}
                  disabled={!analysis.rebuildAvailability?.canRebuild || analysis.starting || busy}
                  aria-describedby="documents-rebuild-hint"
                  data-testid="rebuild-study-button"
                  onClick={(event) => {
                    analysis.returnFocusRef.current = event.currentTarget;
                    analysis.rebuild();
                  }}
                >
                  Rebuild study
                </button>
              ) : null}
            </div>
          </div>

          <p id="documents-read-hint" className="m-0 text-small text-graphite" aria-live="polite">
            {analysis.active && toRead > 0
              ? "Reading your documents. This usually takes a few minutes."
              : toRead > 0
                ? `${toRead} document${toRead === 1 ? " isn't" : "s aren't"} read yet. Analyze reads ${toRead === 1 ? "it" : "them"} first.`
                : "Every added document has been read."}
            {analysis.availability ? (
              <span id="documents-analyze-hint" className="block">
                {analyzeHint(analysis.availability)}
              </span>
            ) : null}
            {showRebuild && analysis.rebuildAvailability ? (
              <span id="documents-rebuild-hint" className="block">
                {rebuildHint(analysis.rebuildAvailability)}
              </span>
            ) : null}
          </p>

          <ul aria-label="Documents in this hive" className="m-0 flex list-none flex-col p-0">
            {documents.map((document) => {
              const meta = documentMeta[document.sourceDocumentId.toLowerCase()];
              const label = meta?.label ?? `Document ${(unlabelled += 1)}`;
              return (
                <DocumentRow
                  key={document.id}
                  hiveId={hiveId}
                  document={document}
                  label={label}
                  meta={meta}
                  pages={pagesById.get(document.sourceDocumentId.toLowerCase())}
                  status={documentRowStatus(document, analysis.active)}
                />
              );
            })}
          </ul>
        </div>
      ) : null}

      <AnalyzeModal
        hiveId={hiveId}
        mode={analysis.modalMode}
        action={analysis.action}
        run={analysis.run}
        studyRevision={analysis.state?.studyRevision ?? null}
        reportRuns={analysis.reportRuns}
        eligibility={analysis.state?.eligibility ?? null}
        pollState={analysis.pollState}
        starting={analysis.starting}
        startError={analysis.startError}
        returnFocusRef={analysis.returnFocusRef}
        onClose={analysis.closeModal}
        onConfirm={analysis.confirmCoverage}
        onAcknowledge={() => void analysis.acknowledge()}
        onRetry={analysis.retry}
      />
    </section>
  );
}
