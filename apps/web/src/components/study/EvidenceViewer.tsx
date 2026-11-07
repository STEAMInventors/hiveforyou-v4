"use client";

import { createContext, type ComponentType, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { documentPageTextPath, evidenceViewerOpenPath, postViewerOpenInit } from "@/lib/evidence-view-urls";
import { isHttpOrHttpsUrlString, signedUrlShapeForLog } from "@/lib/signed-url-log-shape";

import { type CitationContext, type SiblingPageTarget } from "./citation-context";
import type { EvidenceHighlightStatus, EvidencePdfPageProps } from "./EvidencePdfPage";
import { HiveMark } from "./HiveMark";
import { loadEvidencePdfPage } from "./load-evidence-pdf-page";
import { type ChipRef } from "./SourceChip";

type EvidenceViewerValue = {
  readonly labelFor: (sourceDocumentId: string) => string;
  readonly chipLabelFor: (sourceDocumentId: string) => string;
  readonly open: (chip: ChipRef, trigger?: HTMLElement | null) => void;
};

const FALLBACK: EvidenceViewerValue = {
  labelFor: () => "Document",
  chipLabelFor: () => "Document",
  open: () => undefined,
};

function viewerMimeCategory(mime: string | null): "pdf" | "image" | "other" {
  const m = (mime ?? "").trim().toLowerCase();
  if (m === "application/pdf" || m.endsWith("/pdf")) return "pdf";
  if (m.startsWith("image/")) return "image";
  return "other";
}

const EvidenceViewerContext = createContext<EvidenceViewerValue>(FALLBACK);

export function useEvidenceViewer(): EvidenceViewerValue {
  return useContext(EvidenceViewerContext);
}

type EvidenceViewerProviderProps = {
  hiveId: string;
  labels: ReadonlyMap<string, string>;
  /** Short document kind for chips (≤3 words; numbered when ambiguous). */
  chipLabels?: ReadonlyMap<string, string>;
  pageCountFor?: (sourceDocumentId: string) => number | undefined;
  citationContexts?: ReadonlyMap<string, readonly { context: CitationContext; siblings: readonly SiblingPageTarget[] }[]>;
  children: ReactNode;
};

function chipMapKey(sourceDocumentId: string, pageNumber: number): string {
  return `${sourceDocumentId}:${pageNumber}`;
}

export function EvidenceViewerProvider({
  hiveId,
  labels,
  chipLabels,
  pageCountFor = () => undefined,
  citationContexts = new Map(),
  children,
}: EvidenceViewerProviderProps) {
  const [state, setState] = useState<{
    chip: ChipRef;
    pageNumber: number;
  } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [pageText, setPageText] = useState<string | null>(null);
  const [pageMime, setPageMime] = useState<string | null>(null);
  /** Registered file MIME from vault (viewer-open); overrides DB/page-text when set. */
  const [vaultMime, setVaultMime] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [highlightStatus, setHighlightStatus] = useState<EvidenceHighlightStatus | null>(null);
  const [neighborPageText, setNeighborPageText] = useState<string | null>(null);
  /** Lazy pdf viewer (react-pdf) — loaded only when a PDF chip opens; `import()` keeps it out of the initial Study bundle. */
  const [PdfViewer, setPdfViewer] = useState<ComponentType<EvidencePdfPageProps> | null>(null);
  const [pdfViewerLoadError, setPdfViewerLoadError] = useState(false);
  const announceRef = useRef<HTMLDivElement | null>(null);

  const labelFor = useCallback((id: string) => labels.get(id) ?? "Document", [labels]);
  const open = useCallback((next: ChipRef, trigger?: HTMLElement | null) => {
    triggerRef.current = trigger ?? null;
    setSignedUrl(null);
    setPageText(null);
    setPageMime(null);
    setVaultMime(null);
    setLoadError(null);
    setHighlightStatus(null);
    setNeighborPageText(null);
    setPdfViewer(null);
    setPdfViewerLoadError(false);
    setState({ chip: next, pageNumber: next.pageNumber });
  }, []);

  const close = useCallback(() => {
    setState(null);
    setSignedUrl(null);
    setPageText(null);
    setPageMime(null);
    setVaultMime(null);
    setLoadError(null);
    setHighlightStatus(null);
    setNeighborPageText(null);
    setPdfViewer(null);
    setPdfViewerLoadError(false);
    triggerRef.current?.focus();
  }, []);

  const chip = state?.chip ?? null;
  const pageNumber = state?.pageNumber ?? 1;
  const totalPages = chip ? (() => {
    const n = pageCountFor(chip.sourceDocumentId);
    return typeof n === "number" && n >= 1 ? n : 1;
  })() : 1;
  const chipLabelFor = useCallback(
    (id: string) => (chipLabels?.get(id) ?? labels.get(id) ?? "Document"),
    [chipLabels, labels],
  );
  const docLabel = chip ? chipLabelFor(chip.sourceDocumentId) : "Document";
  const titleId = "evidence-viewer-title";
  const subtitleId = "evidence-viewer-subtitle";

  const contexts = useMemo(() => {
    if (!chip) return [];
    const key = chipMapKey(chip.sourceDocumentId, pageNumber);
    const list = citationContexts.get(key) ?? [];
    const ids = new Set(chip.factIds ?? []);
    if (ids.size === 0) return list;
    const matched = list.filter((item) => ids.has(item.context.factId));
    return matched.length > 0 ? matched : list;
  }, [chip, pageNumber, citationContexts]);

  const primaryContext = contexts[0]?.context;
  const siblingPages = contexts[0]?.siblings ?? [];
  const quoteForHighlight = primaryContext?.verifiedQuote ?? chip?.quote ?? "";
  const effectiveMime = vaultMime ?? pageMime;
  const mimeKind = viewerMimeCategory(effectiveMime);
  const isPdf = mimeKind === "pdf";
  const isImage = mimeKind === "image";

  useEffect(() => {
    if (!chip) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chip, close]);

  useEffect(() => {
    if (!chip) return;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      setSignedUrl(null);
      setPageText(null);
      setPageMime(null);
      setVaultMime(null);
      setHighlightStatus(null);
    setNeighborPageText(null);
      try {
        let resolvedMime: string | null = null;
        const textRes = await fetch(documentPageTextPath(hiveId, chip.sourceDocumentId, pageNumber));
        if (textRes.ok) {
          const t = (await textRes.json()) as { pageText?: string; mimeType?: string };
          if (!cancelled && typeof t.pageText === "string") setPageText(t.pageText);
          resolvedMime = typeof t.mimeType === "string" ? t.mimeType : null;
          if (!cancelled) setPageMime(resolvedMime);
        } else if (!cancelled) {
          setPageText(null);
          setPageMime(null);
        }
        if (cancelled) return;

        if (pageNumber < totalPages) {
          const nextRes = await fetch(documentPageTextPath(hiveId, chip.sourceDocumentId, pageNumber + 1));
          if (!cancelled && nextRes.ok) {
            const nextBody = (await nextRes.json()) as { pageText?: string };
            if (typeof nextBody.pageText === "string") setNeighborPageText(nextBody.pageText);
          } else if (!cancelled) {
            setNeighborPageText(null);
          }
        } else if (!cancelled) {
          setNeighborPageText(null);
        }
        if (cancelled) return;

        const openRes = await fetch(evidenceViewerOpenPath(hiveId, chip.sourceDocumentId), postViewerOpenInit(pageNumber));
        if (!openRes.ok) {
          setLoadError("Could not open the document.");
          return;
        }
        const body = (await openRes.json()) as { signedUrl?: string; mimeType?: string };
        if (cancelled) return;
        if (typeof body.signedUrl !== "string" || !isHttpOrHttpsUrlString(body.signedUrl)) {
          setLoadError("Could not open the document.");
          console.warn("[evidence-viewer] viewer-open returned invalid signedUrl shape (expected https URL string)");
          return;
        }
        if (typeof body.mimeType === "string" && body.mimeType.trim() !== "") {
          setVaultMime(body.mimeType.trim());
        }
        const shape = signedUrlShapeForLog(body.signedUrl);
        const kindForLog = viewerMimeCategory(
          typeof body.mimeType === "string" && body.mimeType.trim() !== "" ? body.mimeType.trim() : resolvedMime,
        );
        if (shape.kind === "ok" && process.env.NODE_ENV !== "test") {
          console.info(
            `[evidence-viewer] signedUrlReady host=${shape.host} scheme=${shape.scheme} pathSegments=${shape.pathSegmentCount} mimeKind=${kindForLog}`,
          );
        } else if (shape.kind !== "ok") {
          console.warn("[evidence-viewer] signedUrlReady could not parse URL shape");
        }
        setSignedUrl(body.signedUrl);
      } catch {
        if (!cancelled) setLoadError("Could not open the document.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chip, hiveId, pageNumber, totalPages]);

  const highlightStatusLine = useMemo(() => {
    if (!highlightStatus) return null;
    if (highlightStatus.kind === "not_found") {
      return "Couldn't find this passage on the page; the quote is shown below.";
    }
    if (highlightStatus.kind === "fuzzy") {
      return "Close match highlighted";
    }
    const pages = highlightStatus.highlightedPages ?? [highlightStatus.pageNumber];
    if (pages.length > 1) {
      return `Highlighted on pages ${pages.join(" and ")}`;
    }
    return `Highlighted on page ${pages[0] ?? pageNumber}`;
  }, [highlightStatus, pageNumber]);

  useEffect(() => {
    if (!highlightStatusLine || !chip) return;
    const live = announceRef.current;
    if (!live) return;
    live.textContent = "";
    requestAnimationFrame(() => {
      live.textContent = highlightStatusLine;
    });
  }, [highlightStatusLine, chip]);

  const onHighlightStatus = useCallback((status: EvidenceHighlightStatus) => {
    setHighlightStatus(status);
  }, []);

  const originalPageHref =
    chip != null
      ? `/api/v1/hives/${encodeURIComponent(hiveId)}/source-documents/${encodeURIComponent(chip.sourceDocumentId)}/pages/${encodeURIComponent(String(pageNumber))}`
      : undefined;

  useEffect(() => {
    if (!signedUrl || !isPdf) {
      setPdfViewer(null);
      setPdfViewerLoadError(false);
      return;
    }
    let cancelled = false;
    setPdfViewerLoadError(false);
    setPdfViewer(null);
    void loadEvidencePdfPage()
      .then((m) => {
        if (!cancelled) setPdfViewer(() => m.EvidencePdfPage);
      })
      .catch(() => {
        if (!cancelled) setPdfViewerLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedUrl, isPdf]);

  const value = useMemo(() => ({ labelFor, chipLabelFor, open }), [labelFor, chipLabelFor, open]);

  return (
    <EvidenceViewerContext.Provider value={value}>
      {children}
      {chip ? (
        <>
          <div className="fixed inset-0 z-50 bg-ink/30 md:bg-ink/20" onClick={close} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${titleId} ${subtitleId}`}
            data-testid="evidence-viewer"
            className="fixed inset-0 z-[51] flex w-full flex-col bg-paper md:inset-y-0 md:left-auto md:right-0 md:top-0 md:h-full md:min-w-[420px] md:w-[45vw] md:max-w-none md:shadow-elev"
          >
            <div
              className="flex h-full min-h-0 flex-col overflow-y-auto md:max-w-none md:rounded-l-card md:border-l md:border-line"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-line bg-paper px-5 py-4 sm:px-7">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 id={titleId} className="m-0 flex min-w-0 items-center gap-2 truncate font-brand text-section font-semibold text-ink">
                      <HiveMark className="h-5 w-5 shrink-0" />
                      <span className="min-w-0 truncate">{docLabel}</span>
                    </h2>
                    <p id={subtitleId} className="m-0 text-small text-quiet">
                      Page {pageNumber} of {totalPages}
                    </p>
                  </div>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={close}
                    className="inline-flex h-11 shrink-0 items-center rounded-control border border-line bg-paper px-4 text-small font-medium text-ink hover:bg-mist"
                  >
                    Close
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-10 min-w-[44px] items-center justify-center rounded-control border border-line bg-paper px-3 text-small text-ink hover:bg-mist disabled:opacity-40"
                    disabled={pageNumber <= 1}
                    onClick={() => setState((s) => (s ? { ...s, pageNumber: Math.max(1, s.pageNumber - 1) } : s))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-10 min-w-[44px] items-center justify-center rounded-control border border-line bg-paper px-3 text-small text-ink hover:bg-mist disabled:opacity-40"
                    disabled={pageNumber >= totalPages}
                    onClick={() =>
                      setState((s) => (s ? { ...s, pageNumber: Math.min(totalPages, s.pageNumber + 1) } : s))
                    }
                  >
                    Next
                  </button>
                  <a
                    href={`/api/v1/hives/${encodeURIComponent(hiveId)}/source-documents/${encodeURIComponent(
                      chip.sourceDocumentId,
                    )}/pages/${encodeURIComponent(String(pageNumber))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-small text-graphite underline decoration-quiet underline-offset-2 hover:text-ink"
                    data-testid="evidence-open-original"
                  >
                    Open the original
                  </a>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4 sm:px-7">
                {loadError ? <p className="m-0 text-small text-coral-deep">{loadError}</p> : null}
                {pdfViewerLoadError ? <p className="m-0 text-small text-coral-deep">Could not load the PDF viewer.</p> : null}
                {highlightStatusLine && isPdf ? (
                  <p className="m-0 text-small text-graphite" data-testid="evidence-highlight-status">
                    {highlightStatusLine}
                  </p>
                ) : null}
                {signedUrl && isPdf && PdfViewer ? (
                  <PdfViewer
                    fileUrl={signedUrl}
                    pageNumber={pageNumber}
                    quote={quoteForHighlight}
                    pageText={pageText}
                    neighborPageText={neighborPageText}
                    neighborPageNumber={pageNumber < totalPages ? pageNumber + 1 : undefined}
                    onHighlightStatus={onHighlightStatus}
                    originalPageHref={originalPageHref}
                  />
                ) : null}
                {signedUrl && isPdf && !PdfViewer && !pdfViewerLoadError ? (
                  <p className="m-0 text-small text-quiet">Loading viewer…</p>
                ) : null}
                {signedUrl && isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed URL from owner session
                  <img src={signedUrl} alt="" className="max-h-[min(70vh,720px)] w-full object-contain" data-testid="evidence-image-page" />
                ) : null}
                {signedUrl && !isPdf && !isImage && pageText ? (
                  <blockquote className="m-0 max-h-[min(70vh,720px)] overflow-y-auto whitespace-pre-wrap rounded-card border border-line bg-mist p-4 font-quote text-small text-ink">
                    {pageText}
                  </blockquote>
                ) : null}
                {!signedUrl && !loadError ? <p className="m-0 text-small text-quiet">Loading…</p> : null}
                {quoteForHighlight.trim() !== "" && !isPdf && isImage && !!signedUrl ? (
                  <p className="m-0 text-small text-graphite" data-testid="evidence-quote-unlocated">
                    The quote is on this page; its exact position couldn&apos;t be marked.
                  </p>
                ) : null}

                <div className="flex flex-col gap-3 border-t border-line pt-4 md:order-none">
                  <h3 className="m-0 text-caption font-semibold text-quiet">What this supports</h3>
                  {primaryContext ? (
                    <div className="flex flex-col gap-2 text-body text-ink">
                      <p className="m-0">{primaryContext.supportingText}</p>
                      {primaryContext.valueAsWritten ? (
                        <p className="m-0 font-quote text-ink">
                          <span className="sr-only">Value as written: </span>
                          {primaryContext.valueAsWritten}
                        </p>
                      ) : null}
                      <blockquote className="m-0 border-l-2 border-honey-chip-border pl-4 font-quote text-small text-graphite">
                        {primaryContext.verifiedQuote}
                      </blockquote>
                    </div>
                  ) : (
                    <p className="m-0 text-small text-quiet">Citation context is not available for this chip.</p>
                  )}
                  {siblingPages.length > 0 ? (
                    <div className="flex flex-wrap gap-2" data-testid="evidence-sibling-pages">
                      {siblingPages.map((s) => (
                        <button
                          key={s.pageNumber}
                          type="button"
                          className="inline-flex min-h-10 items-center rounded-chip border border-line bg-mist px-3 text-small text-ink hover:bg-paper"
                          onClick={() => setState((st) => (st ? { ...st, pageNumber: s.pageNumber } : st))}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <div ref={announceRef} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
        </>
      ) : null}
    </EvidenceViewerContext.Provider>
  );
}
