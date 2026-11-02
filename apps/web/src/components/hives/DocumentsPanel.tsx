"use client";

import {
  type DocumentRead,
  documentNeedsReading,
  type SourceDocument,
  type UploadQuota,
} from "@hiveforyou/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { HiveClientError } from "@/lib/hives-client";
import { fetchSourceDocuments, fetchUploadQuota } from "@/lib/source-documents-client";

import { readStatusPresentation, retryableFailedReads } from "./document-read-progress";
import { ReadDocumentsModal } from "./ReadDocumentsModal";
import { AddFilesButton, SelectedFileList } from "./SourceFilePicker";
import {
  MAX_FILES_PER_BATCH,
  rejectionMessage,
  toSelectedSourceFiles,
  uploadSelectedSourceFiles,
  type SelectedSourceFile,
} from "./source-file-upload";
import { useDocumentReads } from "./useDocumentReads";

type LoadError = { message: string; correlationId: string | null };

type DocumentsPanelProps = {
  hiveId: string;
  initialDocuments: SourceDocument[];
  initialError?: LoadError | null;
};

const TYPE_LABELS: Record<SourceDocument["mimeType"], string> = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPG",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const READ_STATUS_DETAIL: Record<SourceDocument["readStatus"], string> = {
  PENDING: "Not read yet.",
  SUCCEEDED: "Every page is saved and checked.",
  PARTIAL: "Some pages had no readable text.",
  UNREADABLE: "No readable text was found.",
  FAILED: "Reading didn't finish. You can try again.",
};

function statusOf(
  document: SourceDocument,
  latestRead: DocumentRead | undefined,
): { label: string; detail: string; className: string } {
  if (document.status === "REJECTED") {
    return {
      label: "Not accepted",
      detail: rejectionMessage(document),
      className: "bg-coral-wash text-coral-deep",
    };
  }
  if (document.status === "PENDING") {
    return {
      label: "Upload not finished",
      detail: "Add this file again to finish uploading it.",
      className: "bg-honey-wash text-honey-deep",
    };
  }
  if (latestRead && latestRead.status !== "SUCCEEDED" && latestRead.status !== "PARTIAL") {
    const presentation = readStatusPresentation(latestRead.status);
    const finished = latestRead.status === "UNREADABLE" || latestRead.status === "FAILED";
    return {
      ...presentation,
      detail: finished
        ? (latestRead.errorMessageSafe ?? READ_STATUS_DETAIL[document.readStatus])
        : "Reading in progress.",
    };
  }
  if (document.readStatus === "PENDING") {
    return { label: "Added", detail: READ_STATUS_DETAIL.PENDING, className: "bg-mist text-ink-muted" };
  }
  return {
    ...readStatusPresentation(document.readStatus),
    detail: READ_STATUS_DETAIL[document.readStatus],
  };
}

function toLoadError(error: unknown, fallback: string): LoadError {
  return error instanceof HiveClientError
    ? { message: error.message, correlationId: error.correlationId || null }
    : { message: fallback, correlationId: null };
}

function DocumentIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
    </svg>
  );
}

export function DocumentsPanel({ hiveId, initialDocuments, initialError = null }: DocumentsPanelProps) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [loadError, setLoadError] = useState<LoadError | null>(initialError);
  const [quota, setQuota] = useState<UploadQuota | null>(null);
  const [batch, setBatch] = useState<SelectedSourceFile[]>([]);
  const [busy, setBusy] = useState(false);

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

  const reading = useDocumentReads(hiveId, () => void refresh());
  const latestReadByDocument = useMemo(
    () => new Map(reading.reads.map((read) => [read.sourceDocumentId, read])),
    [reading.reads],
  );
  const fileNames = useMemo(
    () => new Map(documents.map((document) => [document.id, document.fileName])),
    [documents],
  );
  const needsReading = documents.filter((document) =>
    documentNeedsReading(document, latestReadByDocument.get(document.id)),
  );
  const readDisabled = needsReading.length === 0 || reading.active || reading.starting || busy;
  const retryable = retryableFailedReads(reading.reads);

  const addFiles = async (picked: File[]) => {
    const selected = toSelectedSourceFiles(picked).slice(0, MAX_FILES_PER_BATCH);
    setBatch(selected);
    setBusy(true);
    try {
      await uploadSelectedSourceFiles(hiveId, selected, (key, patch) =>
        setBatch((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item))),
      );
      await refresh();
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
        : `${remaining} of ${quota?.limit} free uploads left this month. PDF, PNG, JPG or DOCX, up to 25 MB each.`;

  return (
    <section aria-labelledby="documents-title" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="documents-title" className="m-0 font-brand text-[30px] font-semibold text-ink">
            Documents{documents.length > 0 ? ` (${documents.length})` : ""}
          </h1>
          <p id="documents-quota" className="m-0 mt-1.5 text-[15px] text-ink-muted" aria-live="polite">
            {quotaText}
          </p>
        </div>
        {documents.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <AddFilesButton
              showLabel
              disabled={addDisabled}
              describedBy="documents-quota"
              onAdd={(picked) => void addFiles(picked)}
            />
            {reading.active ? (
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                onClick={(event) => {
                  reading.returnFocusRef.current = event.currentTarget;
                  reading.openModal();
                }}
              >
                Show reading progress
              </button>
            ) : (
              <button
                type="button"
                className={PRIMARY_BUTTON_CLASS}
                disabled={readDisabled}
                aria-describedby="documents-read-hint"
                onClick={(event) => {
                  reading.returnFocusRef.current = event.currentTarget;
                  void reading.start();
                }}
              >
                {reading.starting ? "Starting…" : "Read Documents"}
              </button>
            )}
          </div>
        ) : null}
      </div>

      {documents.length > 0 ? (
        <p id="documents-read-hint" className="-mt-3 mb-0 text-[13px] text-ink-subtle" aria-live="polite">
          {reading.active
            ? "Reading is in progress. You can leave this page; it keeps going."
            : needsReading.length > 0
              ? `${needsReading.length} document${needsReading.length === 1 ? " needs" : "s need"} reading.`
              : "Every added document has been read."}
        </p>
      ) : null}

      {reading.startError && !reading.modalOpen ? (
        <div role="alert" className="rounded-card border border-line bg-paper px-4 py-3 text-sm text-coral-deep">
          {reading.startError.message}
          {reading.startError.correlationId ? (
            <span className="mt-1 block font-mono text-xs text-ink-subtle">
              Support reference: {reading.startError.correlationId}
            </span>
          ) : null}
        </div>
      ) : null}

      {loadError ? (
        <div role="alert" className="rounded-card border border-line bg-paper p-6 text-center">
          <p className="m-0 text-sm text-ink">{loadError.message}</p>
          {loadError.correlationId ? (
            <p className="mb-0 mt-2 font-mono text-xs text-ink-subtle">
              Support reference: {loadError.correlationId}
            </p>
          ) : null}
          <button type="button" className={`${SECONDARY_BUTTON_CLASS} mt-4`} onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      ) : null}

      <SelectedFileList files={batch} label="Uploading documents" busy />

      {!loadError && documents.length === 0 ? (
        <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong bg-paper px-8 py-14 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-mist text-ink-subtle">
            <DocumentIcon />
          </span>
          <h2 className="m-0 font-brand text-[21px] font-medium text-ink">No documents yet</h2>
          <p className="mx-auto mb-5 mt-2 max-w-md text-[15px] leading-[1.55] text-ink-muted">
            Add the documents you have. Each one is checked and kept private to your account.
          </p>
          <AddFilesButton
            showLabel
            disabled={addDisabled}
            describedBy="documents-quota"
            onAdd={(picked) => void addFiles(picked)}
          />
        </div>
      ) : null}

      {documents.length > 0 ? (
        <ul aria-label="Documents in this Hive" className="m-0 flex list-none flex-col gap-2.5 p-0">
          {documents.map((document) => {
            const status = statusOf(document, latestReadByDocument.get(document.id));
            return (
              <li
                key={document.id}
                className="flex flex-wrap items-start gap-3 rounded-card border border-line bg-paper px-4 py-3.5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-button bg-mist font-mono text-[11px] font-medium text-ink-subtle">
                  {TYPE_LABELS[document.mimeType]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[15px] font-medium text-ink" title={document.fileName}>
                    {document.fileName}
                  </p>
                  <p className="m-0 mt-0.5 text-xs text-ink-subtle">
                    Added {dateFormat.format(new Date(document.createdAt))} · {status.detail}
                  </p>
                </div>
                <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium ${status.className}`}>
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <ReadDocumentsModal
        open={reading.modalOpen}
        reads={reading.reads}
        fileNames={fileNames}
        pollState={reading.pollState}
        arrival={reading.arrival}
        returnFocusRef={reading.returnFocusRef}
        onClose={reading.closeModal}
        onRetry={
          retryable.length > 0
            ? () => void reading.start(retryable.map((read) => read.sourceDocumentId))
            : null
        }
        retryBusy={reading.starting}
        retryError={reading.startError}
      />
    </section>
  );
}
