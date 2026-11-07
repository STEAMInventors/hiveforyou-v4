"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, type DocumentProps, Page, pdfjs } from "react-pdf";

import { isHttpOrHttpsUrlString, signedUrlShapeForLog } from "@/lib/signed-url-log-shape";

import {
  buildPdfTextIndex,
  findCrossPageQuoteParts,
  findQuoteMatch,
  renderHighlightedItemText,
  spansToItemHighlights,
  type ItemHighlightRange,
  type PdfTextItem,
  type QuoteMatchKind,
} from "./evidence-highlight";

/**
 * Evidence drawer PDF failures were a pdf.js API vs worker version mismatch (two pdfjs-dist copies),
 * not MIME routing alone — vault MIME from viewer-open is still required for correct mode selection.
 */
if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

export type EvidenceHighlightStatus = {
  readonly kind: QuoteMatchKind;
  readonly pageNumber: number;
  /** When a quote straddles pages, both page numbers that received a highlight. */
  readonly highlightedPages?: readonly number[];
};

export type EvidencePdfPageProps = {
  readonly fileUrl: string;
  readonly pageNumber: number;
  readonly quote: string | undefined;
  readonly pageText: string | null;
  readonly neighborPageText?: string | null;
  readonly neighborPageNumber?: number;
  readonly onHighlightStatus: (status: EvidenceHighlightStatus) => void;
  /** Owner session page route — shown after an in-viewer PDF load failure (not the signed vault URL). */
  readonly originalPageHref?: string;
};

function documentFileProp(fileUrl: string): DocumentProps["file"] {
  return isHttpOrHttpsUrlString(fileUrl) ? { url: fileUrl } : fileUrl;
}

type PageHighlightState = {
  readonly page: number;
  readonly byItem: ReadonlyMap<number, readonly ItemHighlightRange[]>;
};

export function EvidencePdfPage({
  fileUrl,
  pageNumber,
  quote,
  pageText,
  neighborPageText,
  neighborPageNumber,
  onHighlightStatus,
  originalPageHref,
}: EvidencePdfPageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(720);
  const [highlights, setHighlights] = useState<readonly PageHighlightState[]>([]);
  const textItemsRef = useRef<Map<number, readonly PdfTextItem[]>>(new Map());
  const [textLayerReady, setTextLayerReady] = useState(false);

  const file = useMemo(() => documentFileProp(fileUrl), [fileUrl]);

  const boundFileUrlRef = useRef(fileUrl);
  if (boundFileUrlRef.current !== fileUrl) {
    boundFileUrlRef.current = fileUrl;
    setPdfLoadError(null);
    setNumPages(null);
    setHighlights([]);
    textItemsRef.current = new Map();
    setTextLayerReady(false);
  }

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setPageWidth(w - 4);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const neighborPage =
    typeof neighborPageNumber === "number" && neighborPageNumber >= 1 ? neighborPageNumber : null;

  const recomputeHighlights = useCallback(() => {
    const q = quote?.trim() ?? "";
    if (!q) {
      setHighlights([]);
      onHighlightStatus({ kind: "not_found", pageNumber });
      return;
    }

    const items = textItemsRef.current.get(pageNumber);
    if (!items?.length) {
      setHighlights([]);
      if (textLayerReady) onHighlightStatus({ kind: "not_found", pageNumber });
      return;
    }

    const index = buildPdfTextIndex(items);
    let match = findQuoteMatch(index.normText, q);

    const pagesToRender: PageHighlightState[] = [];
    const cross =
      neighborPage !== null && neighborPageText
        ? findCrossPageQuoteParts(q, pageText ?? "", neighborPageText, neighborPage)
        : null;

    if (match.kind === "not_found" && cross && neighborPage !== null) {
      const neighborNum = neighborPage;
      const byItem = spansToItemHighlights(index, [cross.currentPageSpan]);
      pagesToRender.push({ page: pageNumber, byItem });
      const neighborItems = textItemsRef.current.get(neighborNum);
      if (neighborItems?.length) {
        const neighborIndex = buildPdfTextIndex(neighborItems);
        const neighborByItem = spansToItemHighlights(neighborIndex, [cross.neighborPageSpan]);
        pagesToRender.push({ page: neighborNum, byItem: neighborByItem });
      }
      setHighlights(pagesToRender);
      onHighlightStatus({
        kind: "exact",
        pageNumber,
        highlightedPages: pagesToRender.map((p) => p.page),
      });
      return;
    }

    if (match.kind === "not_found" && pageText) {
      match = findQuoteMatch(pageText, q);
    }

    if (match.kind === "not_found") {
      setHighlights([]);
      onHighlightStatus({ kind: "not_found", pageNumber });
      return;
    }

    const byItem = spansToItemHighlights(index, match.spans);
    pagesToRender.push({ page: pageNumber, byItem });
    setHighlights(pagesToRender);
    onHighlightStatus({
      kind: match.kind,
      pageNumber,
      highlightedPages: [pageNumber],
    });
  }, [quote, pageNumber, pageText, neighborPage, neighborPageText, onHighlightStatus, textLayerReady]);

  const highlightMapsRef = useRef(new Map<number, ReadonlyMap<number, readonly ItemHighlightRange[]>>());
  highlightMapsRef.current = new Map(highlights.map((entry) => [entry.page, entry.byItem]));

  const highlightGeneration = highlights.reduce(
    (sum, entry) => sum + entry.byItem.size,
    highlights.length,
  );

  const makeCustomTextRenderer = useCallback((targetPage: number) => {
    return ({ itemIndex, str }: { itemIndex: number; str: string }) =>
      renderHighlightedItemText(str, highlightMapsRef.current.get(targetPage)?.get(itemIndex));
  }, []);

  const customTextRendererPrimary = useMemo(
    () => makeCustomTextRenderer(pageNumber),
    [makeCustomTextRenderer, pageNumber],
  );

  const customTextRendererNeighbor = useMemo(() => {
    if (neighborPage === null) return undefined;
    return makeCustomTextRenderer(neighborPage);
  }, [makeCustomTextRenderer, neighborPage]);

  const handleGetTextSuccess = useCallback(
    (targetPage: number) => (payload: { items: unknown[] }) => {
      const items: PdfTextItem[] = payload.items
        .filter((item): item is PdfTextItem => typeof item === "object" && item !== null && "str" in item)
        .map((item) => ({
          str: String((item as { str?: string }).str ?? ""),
          hasEOL: Boolean((item as { hasEOL?: boolean }).hasEOL),
        }));
      const prev = textItemsRef.current.get(targetPage);
      const unchanged =
        prev &&
        prev.length === items.length &&
        prev.every((row, idx) => row.str === items[idx]?.str && row.hasEOL === items[idx]?.hasEOL);
      if (unchanged) return;
      textItemsRef.current.set(targetPage, items);
      if (targetPage === pageNumber) setTextLayerReady(true);
      recomputeHighlights();
    },
    [recomputeHighlights, pageNumber],
  );

  useEffect(() => {
    if (!quote?.trim()) recomputeHighlights();
  }, [quote, recomputeHighlights]);

  useEffect(() => {
    if (highlights.length === 0) return;
    const root = wrapRef.current;
    if (!root) return;
    const mark = root.querySelector(".evidence-highlight");
    if (!mark || !(mark instanceof HTMLElement)) return;
    if (typeof mark.scrollIntoView === "function") {
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlights, pageNumber]);

  const handlePdfLoadSuccess = useCallback((d: { numPages: number }) => {
    setNumPages(d.numPages);
  }, []);

  const handlePdfLoadError = useCallback((err: Error) => {
    const shape = signedUrlShapeForLog(fileUrl);
    const detail =
      shape.kind === "ok"
        ? `evidencePdf.loadError name=${err.name} host=${shape.host} scheme=${shape.scheme} pathSegments=${shape.pathSegmentCount}`
        : `evidencePdf.loadError name=${err.name} urlShape=invalid`;
    console.error(`[evidence-pdf] ${detail} message=${err.message}`);
    setPdfLoadError("Could not load this page in the viewer.");
  }, [fileUrl]);

  const handlePageRenderSuccess = useCallback(() => {
    requestAnimationFrame(() => recomputeHighlights());
  }, [recomputeHighlights]);

  const renderNeighbor =
    neighborPage !== null &&
    highlights.some((h) => h.page === neighborPage) &&
    numPages !== null &&
    neighborPage >= 1 &&
    neighborPage <= numPages;

  if (pdfLoadError) {
    const originalHref = originalPageHref?.trim() ? originalPageHref : fileUrl;
    return (
      <div className="flex flex-col gap-2 rounded-card border border-line bg-mist px-4 py-4">
        <p className="m-0 text-small text-coral-deep" data-testid="evidence-pdf-load-error">
          {pdfLoadError}
        </p>
        <a
          href={originalHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-small text-graphite underline decoration-quiet underline-offset-2 hover:text-ink"
          data-testid="evidence-pdf-open-original"
        >
          Open the original
        </a>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative max-h-[min(70vh,720px)] overflow-auto rounded-card border border-line bg-mist">
      <Document file={file} onLoadSuccess={handlePdfLoadSuccess} onLoadError={handlePdfLoadError} loading={null}>
        {numPages !== null && pageNumber >= 1 && pageNumber <= numPages ? (
          <Page
            key={`p-${pageNumber}-h${highlightGeneration}`}
            pageNumber={pageNumber}
            width={pageWidth}
            renderAnnotationLayer={false}
            customTextRenderer={customTextRendererPrimary}
            onGetTextSuccess={handleGetTextSuccess(pageNumber) as (p: { items: unknown[] }) => void}
            onRenderSuccess={handlePageRenderSuccess}
          />
        ) : null}
        {renderNeighbor ? (
          <Page
            key={`p-${neighborPage}-h${highlightGeneration}`}
            pageNumber={neighborPage}
            width={pageWidth}
            renderAnnotationLayer={false}
            customTextRenderer={customTextRendererNeighbor}
            onGetTextSuccess={handleGetTextSuccess(neighborPage) as (p: { items: unknown[] }) => void}
          />
        ) : null}
      </Document>
    </div>
  );
}
