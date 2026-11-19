"use client";

import {
  type CanonicalStudy,
  type CoverageGap,
  formatStudyRevisionAcceptanceDetail,
  type SourceDocument,
  type StudyView,
  type StudyViewReferencedDocument,
  type UploadQuota,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { QUIET_LINK_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import type { DisplayState } from "@/components/study/StatusBadge";
import { StatusBadge } from "@/components/study/StatusBadge";
import { STATE_LABEL } from "@/components/study/status-state";
import type { StudyDocumentMeta } from "@/components/study/study-summary";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";
import { shortDocumentLabels, shortTypeChipLabels } from "@/components/study/SourceChip";
import { hiveReportsPath, hiveStudyPath } from "@/lib/hive-routes";
import { HiveClientError } from "@/lib/hives-client";
import { fetchSourceDocuments, fetchUploadQuota, startDocumentReads } from "@/lib/source-documents-client";

import { MissingDocumentsCard } from "./MissingDocumentsCard";
import {
  DocumentsSourceLibrary,
  libraryEvidenceCoverageLines,
} from "./DocumentsSourceLibrary";
import { buildDocumentsLibraryReadMetrics } from "./documents-library-metrics";
import { AnalyzeModal } from "./AnalyzeModal";
import { analyzeHint, rebuildHint } from "./study-preparation-progress";
import { DocumentDropZone } from "./DocumentDropZone";
import { SelectedFileList } from "./SourceFilePicker";
import {
  MAX_FILES_PER_BATCH,
  rejectionMessage,
  toSelectedSourceFiles,
  uploadSelectedSourceFiles,
  type SelectedSourceFile,
} from "./source-file-upload";
import { useStudyPreparation } from "./useStudyPreparation";

type LoadError = { message: string; correlationId: string | null };

import type { StateCounts } from "@/components/study/state-counts";
import { StatusDot } from "@/components/workspace/StatusDot";

type DocumentsPanelProps = {
  hiveId: string;
  initialDocuments: SourceDocument[];
  initialError?: LoadError | null;
  onNavigateToReports?: () => void;
  /** What the current study says each document is, keyed by lowercase source document id. */
  documentMeta?: Readonly<Record<string, StudyDocumentMeta>>;
  studyView?: StudyView | null;
  canonicalStudy?: CanonicalStudy | null;
  referencedDocuments?: readonly StudyViewReferencedDocument[];
  summaryCounts?: StateCounts | null;
  coverageGaps?: readonly CoverageGap[];
};

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
    case "UNREADABLE":
      return { state: "missing", label: "Missing", detail: READ_STATUS_DETAIL.UNREADABLE };
  }
}

function toLoadError(error: unknown, fallback: string): LoadError {
  return error instanceof HiveClientError
    ? { message: error.message, correlationId: error.correlationId || null }
    : { message: fallback, correlationId: null };
}

const CARD = "flex flex-col gap-3 bg-paper";

export function DocumentsPanel({
  hiveId,
  initialDocuments,
  initialError = null,
  onNavigateToReports,
  documentMeta = {},
  studyView = null,
  canonicalStudy = null,
  referencedDocuments = [],
  summaryCounts = null,
  coverageGaps = [],
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
  const eligibilityDocuments = analysis.state?.eligibility.documents ?? [];
  const readMetrics = useMemo(
    () => buildDocumentsLibraryReadMetrics(eligibilityDocuments, coverageGaps),
    [eligibilityDocuments, coverageGaps],
  );
  const pageCountFor = useCallback(
    (id: string) => readMetrics.pageCounts[id] ?? readMetrics.pageCounts[id.toLowerCase()],
    [readMetrics.pageCounts],
  );
  const chipModel = useMemo(() => {
    const labelled = documents.map((document) => ({
      sourceDocumentId: document.sourceDocumentId,
      typeInPlainWords: documentMeta[document.sourceDocumentId.toLowerCase()]?.typeInPlainWords ?? null,
      date: documentMeta[document.sourceDocumentId.toLowerCase()]?.date ?? null,
    }));
    return {
      labels: shortDocumentLabels(labelled),
      chipLabels: shortTypeChipLabels(labelled),
      coverageLines: libraryEvidenceCoverageLines(documents, readMetrics),
    };
  }, [documents, documentMeta, readMetrics]);

  const retryRead = useCallback(
    async (sourceDocumentId: string) => {
      setBusy(true);
      try {
        await startDocumentReads(hiveId, { clientRequestId: crypto.randomUUID(), sourceDocumentIds: [sourceDocumentId] });
        await refresh();
        void refreshAnalysis();
      } finally {
        setBusy(false);
      }
    },
    [hiveId, refresh, refreshAnalysis],
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

  const analyzeToolbar =
    documents.length > 0 ? (
      <>
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
            className={SECONDARY_BUTTON_CLASS}
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
      </>
    ) : null;

  return (
    <EvidenceViewerProvider
      hiveId={hiveId}
      labels={chipModel.labels}
      chipLabels={chipModel.chipLabels}
      pageCountFor={pageCountFor}
      readCoverageLines={chipModel.coverageLines}
    >
    <section aria-labelledby="documents-title" className="flex flex-col gap-5">
      <h2 id="documents-title" className="sr-only">
        Documents
      </h2>

      {summaryCounts ? (
        <div className="flex flex-wrap gap-2" data-testid="documents-state-row">
          {summaryCounts.needs > 0 ? <StatusDot state="needs" label={`${summaryCounts.needs} To review`} /> : null}
          {summaryCounts.changed > 0 ? <StatusDot state="changed" label={`${summaryCounts.changed} Changed`} /> : null}
          {summaryCounts.missing > 0 ? <StatusDot state="missing" label={`${summaryCounts.missing} Missing`} /> : null}
          {summaryCounts.checked > 0 ? <StatusDot state="checked" label={`${summaryCounts.checked} Checked`} /> : null}
        </div>
      ) : null}

      {canonicalStudy ? (
        <MissingDocumentsCard
          hiveId={hiveId}
          study={canonicalStudy}
          acceptedStudyRevisionId={analysis.state?.studyRevision?.id ?? null}
          acceptedStudyRevisionAcceptedAt={analysis.state?.studyRevision?.createdAt ?? null}
          referencedDocuments={referencedDocuments}
          documents={documents}
          onDocumentsChange={setDocuments}
        />
      ) : null}

      <div id="upload" className="scroll-mt-4" />
      {documents.length === 0 && !loadError ? (
        <div className="flex flex-col gap-3" data-testid="documents-empty-state">
          <p className="m-0 max-w-prose text-body text-graphite">
            Upload whatever you have. Old, partial or out of order is fine.
          </p>
          <DocumentDropZone
            disabled={addDisabled}
            quotaText={quotaText}
            onAdd={(picked) => void addFiles(picked)}
          />
        </div>
      ) : null}

      <p id="documents-quota" className="m-0 text-[13px] text-quiet" aria-live="polite">
        {quotaText}
      </p>

      <SelectedFileList
        files={batch}
        label="Uploading documents"
        busy={busy}
        onRemove={(key) => setBatch((current) => current.filter((item) => item.key !== key))}
      />

      {acceptedRebuild ? (
        <div role="status" data-testid="rebuild-study-status" className={`${CARD} gap-1 text-small text-ink`}>
          <p className="m-0 font-medium">Study revision {acceptedRebuild.revisionNumber} accepted.</p>
          <p className="m-0 text-graphite">
            {formatStudyRevisionAcceptanceDetail(acceptedRebuild)}
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
        <>
          <DocumentsSourceLibrary
            documents={documents}
            documentMeta={documentMeta}
            studyView={studyView}
            metrics={readMetrics}
            readingInProgress={analysis.active}
            addDisabled={addDisabled}
            addDescribedBy="documents-quota"
            onAddFiles={(picked) => void addFiles(picked)}
            onRetryRead={(sourceDocumentId) => void retryRead(sourceDocumentId)}
            toolbar={analyzeToolbar}
          />
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
        </>
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
    </EvidenceViewerProvider>
  );
}
