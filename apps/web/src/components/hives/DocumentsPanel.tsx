"use client";

import {
  buildDocumentsLibraryRows,
  type CanonicalStudy,
  type CoverageGap,
  formatStudyRevisionAcceptanceDetail,
  formatStudyRevisionProvenance,
  readStudyRevisionIdentity,
  type FindingsOpenItem,
  type FindingsTopic,
  type GetStudyPreparationResponse,
  type HiveBoardChecklistItem,
  type SourceDocument,
  type StudyView,
  type StudyViewReferencedDocument,
  type StudyViewSources,
  type UploadQuota,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { QUIET_LINK_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { buildHiveEvidenceViewerModel } from "@/components/study/hive-evidence-model";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";
import { shortDocumentLabels, shortTypeChipLabels } from "@/components/study/SourceChip";
import { Button } from "@/components/ui/Button";
import { MetaDot, MetaLine } from "@/components/ui/MetaLine";
import { EMPTY_OMNI_CATALOG, useRegisterOmniCatalog } from "@/components/ui/omni-catalog";
import { hiveFindingsPath, hiveReportsPath } from "@/lib/hive-routes";
import { studyAvailability } from "@/lib/hives/study-availability";
import {
  mergeOmniCatalog,
  omniDocumentsFromLibraryRows,
  omniOpenItemsFromChecklist,
} from "@/lib/omni-catalog-build";
import { HiveClientError } from "@/lib/hives-client";
import { fetchSourceDocuments, fetchUploadQuota, startDocumentReads } from "@/lib/source-documents-client";

import {
  DocumentsSourceLibrary,
  libraryEvidenceCoverageLines,
} from "./DocumentsSourceLibrary";
import { buildDocumentsLibraryReadMetrics } from "./documents-library-metrics";
import { buildDocumentsSummaryParts } from "./documents-page-model";
import { DocumentsStillToCome } from "./DocumentsStillToCome";
import { AnalyzeModal } from "./AnalyzeModal";
import { CanonicalStudyNotice } from "./CanonicalStudyNotice";
import { analyzeHint, rebuildHint } from "./study-preparation-progress";
import { AddFilesButton } from "./SourceFilePicker";
import { SelectedFileList } from "./SourceFilePicker";
import {
  MAX_FILES_PER_BATCH,
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
  documentMeta?: Readonly<Record<string, import("@/components/study/study-summary").StudyDocumentMeta>>;
  studyView?: StudyView | null;
  sources?: StudyViewSources | null;
  canonicalStudy?: CanonicalStudy | null;
  referencedDocuments?: readonly StudyViewReferencedDocument[];
  coverageGaps?: readonly CoverageGap[];
  checklist?: readonly HiveBoardChecklistItem[];
  openItems?: readonly FindingsOpenItem[];
  topics?: readonly FindingsTopic[];
  initialPreparation?: GetStudyPreparationResponse;
  /** Owner and staff see the legacy-study notice. Clients keep the documents page sentence. */
  showLegacyRebuild?: boolean;
};

function toLoadError(error: unknown, fallback: string): LoadError {
  return error instanceof HiveClientError
    ? { message: error.message, correlationId: error.correlationId || null }
    : { message: fallback, correlationId: null };
}

export function DocumentsPanel({
  hiveId,
  initialDocuments,
  initialError = null,
  onNavigateToReports,
  documentMeta = {},
  studyView = null,
  sources = null,
  canonicalStudy = null,
  referencedDocuments: _referencedDocuments = [],
  coverageGaps = [],
  checklist = [],
  openItems = [],
  topics = [],
  initialPreparation,
  showLegacyRebuild = false,
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
      const [list, quotaResponse] = await Promise.all([fetchSourceDocuments(hiveId), fetchUploadQuota()]);
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

  const analysis = useStudyPreparation(hiveId, { onReportsReady: navigateToReports, initialPreparation });
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
  const olderStudy =
    showLegacyRebuild &&
    studyAvailability({
      revision: analysis.state?.studyRevision ?? null,
      hasCanonicalView: studyView != null && analysis.state?.studyRevision?.format === "canonical-study-1",
      studyLoadError: null,
    }).kind === "older";
  const legacyCanRebuild = Boolean(analysis.rebuildAvailability?.canRebuild) && !analysis.starting && !analysis.active;
  const eligibilityDocuments = analysis.state?.eligibility.documents ?? [];
  const readMetrics = useMemo(
    () => buildDocumentsLibraryReadMetrics(eligibilityDocuments, coverageGaps),
    [eligibilityDocuments, coverageGaps],
  );
  const libraryRows = useMemo(
    () =>
      buildDocumentsLibraryRows({
        documents,
        documentMeta,
        studyView,
        pageCounts: readMetrics.pageCounts,
        verifiedPages: readMetrics.verifiedPages,
        unreadableFirstPage: readMetrics.unreadableFirstPage,
        readingInProgress: analysis.active,
      }),
    [analysis.active, documentMeta, documents, readMetrics, studyView],
  );
  const summaryParts = useMemo(
    () => buildDocumentsSummaryParts(documents, libraryRows, readMetrics),
    [documents, libraryRows, readMetrics],
  );

  const evidenceModel = useMemo(
    () =>
      buildHiveEvidenceViewerModel({
        view: studyView,
        sources,
        canonicalStudy,
        coverageGaps,
        documentPages: readMetrics.pageCounts,
      }),
    [studyView, sources, canonicalStudy, coverageGaps, readMetrics.pageCounts],
  );

  const pageCountFor = useCallback(
    (id: string) => readMetrics.pageCounts[id] ?? readMetrics.pageCounts[id.toLowerCase()],
    [readMetrics.pageCounts],
  );
  const omniCatalog = useMemo(
    () =>
      mergeOmniCatalog({
        statements: EMPTY_OMNI_CATALOG.statements,
        suggestions: EMPTY_OMNI_CATALOG.suggestions,
        documents: omniDocumentsFromLibraryRows(libraryRows),
        openItems: omniOpenItemsFromChecklist(checklist),
      }),
    [checklist, libraryRows],
  );
  useRegisterOmniCatalog(omniCatalog);

  const chipModel = useMemo(() => {
    const labelled = documents.map((document) => ({
      sourceDocumentId: document.sourceDocumentId,
      typeInPlainWords: documentMeta[document.sourceDocumentId.toLowerCase()]?.typeInPlainWords ?? null,
      date: documentMeta[document.sourceDocumentId.toLowerCase()]?.date ?? null,
    }));
    return {
      labels: evidenceModel?.labels ?? shortDocumentLabels(labelled),
      chipLabels: evidenceModel?.chipLabels ?? shortTypeChipLabels(labelled),
      coverageLines: libraryEvidenceCoverageLines(documents, readMetrics),
    };
  }, [documents, documentMeta, evidenceModel, readMetrics]);

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

  const acceptedRevisionId = analysis.state?.studyRevision?.id ?? null;

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
            id="rebuild-study-button"
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

  const openAddPicker = () => {
    const button = document.querySelector<HTMLButtonElement>('[data-documents-add="1"]');
    button?.click();
  };

  const panelBody = (
    <section aria-labelledby="documents-title" className="mx-auto flex w-full max-w-col-wide flex-col gap-6">
      <h2 id="documents-title" className="sr-only">
        Documents
      </h2>

      {documents.length > 0 ? (
        <header className="flex flex-col gap-3 rounded-[12px] border border-line bg-blue-wash px-4 py-3 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
          <MetaLine>
            <span data-testid="documents-meta-files">
              {summaryParts.fileCount} {summaryParts.fileCount === 1 ? "file" : "files"}
            </span>
            {summaryParts.pageCount > 0 ? (
              <>
                <MetaDot />
                <span>{summaryParts.pageCount} pages</span>
              </>
            ) : null}
            {summaryParts.unreadableFiles > 0 ? (
              <>
                <MetaDot />
                <span>
                  {summaryParts.unreadableFiles} with unreadable {summaryParts.unreadableFiles === 1 ? "page" : "pages"}
                </span>
              </>
            ) : null}
            {summaryParts.duplicateSets > 0 ? (
              <>
                <MetaDot />
                <span>
                  {summaryParts.duplicateSets} duplicate {summaryParts.duplicateSets === 1 ? "set" : "sets"} aside
                </span>
              </>
            ) : null}
          </MetaLine>
          <AddFilesButton
            showLabel
            label="Add documents"
            disabled={addDisabled}
            describedBy="documents-quota"
            data-documents-add="1"
            className="inline-flex h-[34px] cursor-pointer items-center gap-2 rounded-button border border-blue-deep bg-blue-deep px-[13px] text-[13.5px] font-semibold text-paper hover:bg-blue-press disabled:cursor-not-allowed disabled:opacity-50 max-[759px]:h-11"
            onAdd={(picked) => void addFiles(picked)}
          />
        </header>
      ) : null}

      <DocumentsStillToCome
        hiveId={hiveId}
        checklist={checklist}
        openItems={openItems}
        sources={sources}
        documents={documents}
        acceptedStudyRevisionId={acceptedRevisionId}
        onDocumentsChange={setDocuments}
        onAddFiles={openAddPicker}
      />

      {documents.length === 0 && !loadError ? (
        <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-mist px-4 py-4" data-testid="documents-empty-state">
          <p className="m-0 font-brand text-[18px] font-semibold text-ink">Documents</p>
          <p className="m-0 text-body text-ink-2">
            Upload whatever you have. Old, partial or out of order is fine.
          </p>
          <AddFilesButton
            showLabel
            label="Add documents"
            disabled={addDisabled}
            describedBy="documents-quota"
            className="inline-flex h-[34px] w-fit cursor-pointer items-center gap-2 rounded-button border border-blue-deep bg-blue-deep px-[13px] text-[13.5px] font-semibold text-paper hover:bg-blue-press disabled:cursor-not-allowed disabled:opacity-50 max-[759px]:h-11"
            onAdd={(picked) => void addFiles(picked)}
            data-documents-add="1"
          />
        </div>
      ) : null}

      <p id="documents-quota" className="m-0 text-meta text-ink-3" aria-live="polite">
        {quotaText}
      </p>

      <SelectedFileList
        files={batch}
        label="Uploading documents"
        busy={busy}
        onRemove={(key) => setBatch((current) => current.filter((item) => item.key !== key))}
      />

      {olderStudy ? (
        <div className="flex flex-col items-start gap-3" data-testid="study-dependent-older">
          <CanonicalStudyNotice />
          {analysis.rebuildAvailability ? (
            <p id="documents-legacy-rebuild-hint" className="m-0 max-w-prose text-meta text-ink-2" data-testid="rebuild-eligibility">
              {rebuildHint(analysis.rebuildAvailability)}
            </p>
          ) : null}
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={!legacyCanRebuild}
            aria-describedby="documents-legacy-rebuild-hint"
            data-testid="documents-legacy-rebuild"
            onClick={(event) => {
              analysis.returnFocusRef.current = event.currentTarget;
              analysis.rebuild();
            }}
          >
            Rebuild the study
          </button>
        </div>
      ) : null}

      {acceptedRebuild ? (
        <div role="status" data-testid="rebuild-study-status" className="flex flex-col gap-1 text-meta text-ink">
          <p className="m-0 font-medium">Study revision {acceptedRebuild.revisionNumber} accepted.</p>
          <p className="m-0 text-ink-2">{formatStudyRevisionAcceptanceDetail(acceptedRebuild)}</p>
          <p className="m-0 text-ink-3" data-testid="rebuild-study-identity">
            {formatStudyRevisionProvenance(readStudyRevisionIdentity({ revision: acceptedRebuild }), acceptedRebuild.revisionNumber)}
          </p>
          <Link href={hiveFindingsPath(hiveId)} className={QUIET_LINK_CLASS} data-testid="rebuild-study-link">
            Open study revision {acceptedRebuild.revisionNumber}
          </Link>
        </div>
      ) : null}

      {analysis.startError && !analysis.modalMode ? (
        <div role="alert" className="flex flex-col gap-1 text-meta text-coral-deep" data-testid="rebuild-start-error">
          {analysis.startError.message}
          {analysis.startError.correlationId ? (
            <span className="block font-mono text-meta text-ink-3">Support reference: {analysis.startError.correlationId}</span>
          ) : null}
        </div>
      ) : null}

      {loadError ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="m-0 text-body text-ink">{loadError.message}</p>
          {loadError.correlationId ? (
            <p className="m-0 font-mono text-meta text-ink-3">Support reference: {loadError.correlationId}</p>
          ) : null}
          <Button variant="secondary" type="button" onClick={() => void refresh()}>
            Try again
          </Button>
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
            onRetryRead={(sourceDocumentId) => void retryRead(sourceDocumentId)}
            toolbar={analyzeToolbar}
          />
          <p id="documents-read-hint" className="m-0 text-meta text-ink-2" aria-live="polite">
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
  );

  return (
    <EvidenceViewerProvider
      hiveId={hiveId}
      labels={chipModel.labels}
      chipLabels={chipModel.chipLabels}
      pageCountFor={pageCountFor}
      citationContexts={evidenceModel?.citationContexts}
      readCoverageLines={chipModel.coverageLines}
      view={studyView}
      sources={sources}
      canonicalStudy={canonicalStudy}
      openItems={openItems}
      topics={topics}
      coverageGaps={coverageGaps}
    >
      {panelBody}
    </EvidenceViewerProvider>
  );
}
