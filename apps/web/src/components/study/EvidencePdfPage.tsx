"use client";

import { normalizeQuoteText } from "@hiveforyou/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, type DocumentProps, Page, pdfjs } from "react-pdf";

import { isHttpOrHttpsUrlString, signedUrlShapeForLog } from "@/lib/signed-url-log-shape";

import { findNormalizedQuoteSpans, type NormalizedSpan } from "./evidence-highlight";

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

type SpanPiece = { el: HTMLElement; normStart: number; normEnd: number };

function buildSpanIndex(container: HTMLElement): { normText: string; pieces: SpanPiece[] } {
  const layer = container.querySelector(".react-pdf__Page__textContent");
  if (!layer) return { normText: "", pieces: [] };
  const spans = [...layer.querySelectorAll("span")].filter((n): n is HTMLElement => n instanceof HTMLElement);
  let normText = "";
  const pieces: SpanPiece[] = [];
  for (const el of spans) {
    const raw = el.textContent ?? "";
    const piece = normalizeQuoteText(raw);
    if (piece === "") continue;
    const sep = normText.length > 0 ? 1 : 0;
    const start = normText.length + sep;
    normText = normText + (sep ? " " : "") + piece;
    pieces.push({ el, normStart: start, normEnd: normText.length });
  }
  return { normText, pieces };
}

function rectsForNormSpans(pieces: readonly SpanPiece[], spans: readonly NormalizedSpan[], scrollRoot: HTMLElement): { left: number; top: number; width: number; height: number }[] {
  const rootRect = scrollRoot.getBoundingClientRect();
  const out: { left: number; top: number; width: number; height: number }[] = [];
  for (const span of spans) {
    for (const p of pieces) {
      const o0 = Math.max(span.start, p.normStart);
      const o1 = Math.min(span.end, p.normEnd);
      if (o0 >= o1) continue;
      const r = p.el.getBoundingClientRect();
      const frac0 = (o0 - p.normStart) / (p.normEnd - p.normStart);
      const frac1 = (o1 - p.normStart) / (p.normEnd - p.normStart);
      const left = r.left + frac0 * r.width - rootRect.left + scrollRoot.scrollLeft;
      const right = r.left + frac1 * r.width - rootRect.left + scrollRoot.scrollLeft;
      const top = r.top - rootRect.top + scrollRoot.scrollTop;
      out.push({ left, top, width: Math.max(1, right - left), height: r.height });
    }
  }
  return out;
}

export type EvidencePdfPageProps = {
  readonly fileUrl: string;
  readonly pageNumber: number;
  readonly quote: string | undefined;
  readonly pageText: string | null;
  readonly onHighlightStatus: (status: { found: boolean; pageNumber: number }) => void;
  /** Owner session page route — shown after an in-viewer PDF load failure (not the signed vault URL). */
  readonly originalPageHref?: string;
};

function documentFileProp(fileUrl: string): DocumentProps["file"] {
  return isHttpOrHttpsUrlString(fileUrl) ? { url: fileUrl } : fileUrl;
}

export function EvidencePdfPage({
  fileUrl,
  pageNumber,
  quote,
  pageText,
  onHighlightStatus,
  originalPageHref,
}: EvidencePdfPageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfLoadError, setPdfLoadError] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(720);
  const [rects, setRects] = useState<{ left: number; top: number; width: number; height: number }[]>([]);

  const file = useMemo(() => documentFileProp(fileUrl), [fileUrl]);

  const boundFileUrlRef = useRef(fileUrl);
  if (boundFileUrlRef.current !== fileUrl) {
    boundFileUrlRef.current = fileUrl;
    setPdfLoadError(null);
    setNumPages(null);
    setRects([]);
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

  const persistedPage = pageText ?? "";

  /** Quote verification uses persisted reader text (same normalization as verify-quotes). */
  const quoteVerifiedOnPage = useMemo(() => {
    if (!quote?.trim()) return null;
    return findNormalizedQuoteSpans(persistedPage, quote);
  }, [quote, persistedPage]);

  const relayoutHighlights = useCallback(() => {
    const root = wrapRef.current;
    if (!root) {
      setRects([]);
      return;
    }
    if (!quote?.trim() || quoteVerifiedOnPage === null || quoteVerifiedOnPage.length === 0) {
      setRects([]);
      return;
    }
    const { normText, pieces } = buildSpanIndex(root);
    if (normText === "") {
      setRects([]);
      return;
    }
    const layerSpans = findNormalizedQuoteSpans(normText, quote);
    if (!layerSpans || layerSpans.length === 0) {
      setRects([]);
      onHighlightStatus({ found: false, pageNumber });
      return;
    }
    const next = rectsForNormSpans(pieces, layerSpans, root);
    setRects(next);
    onHighlightStatus({ found: next.length > 0, pageNumber });
  }, [quote, quoteVerifiedOnPage, pageNumber, onHighlightStatus]);

  useEffect(() => {
    relayoutHighlights();
  }, [relayoutHighlights, pageNumber, fileUrl, pageWidth]);

  useEffect(() => {
    if (!quote?.trim()) {
      onHighlightStatus({ found: false, pageNumber });
      return;
    }
    if (persistedPage === "") {
      onHighlightStatus({ found: false, pageNumber });
      return;
    }
    if (quoteVerifiedOnPage === null) {
      onHighlightStatus({ found: false, pageNumber });
    }
  }, [quoteVerifiedOnPage, persistedPage, pageNumber, onHighlightStatus, quote]);

  useEffect(() => {
    if (rects.length === 0 || !wrapRef.current) return;
    const el = wrapRef.current;
    const scroll = el.scrollTo?.bind(el);
    if (typeof scroll !== "function") return;
    const first = rects.reduce(
      (best, r) => (r.top < best.top ? r : best),
      rects[0]!,
    );
    scroll({ top: Math.max(0, first.top - 24), behavior: "smooth" });
  }, [rects, pageNumber]);

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
    requestAnimationFrame(() => relayoutHighlights());
  }, [relayoutHighlights]);

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
            key={`${pageNumber}`}
            pageNumber={pageNumber}
            width={pageWidth}
            renderAnnotationLayer={false}
            onRenderSuccess={handlePageRenderSuccess}
          />
        ) : null}
      </Document>
      {rects.map((r, i) => (
        <div
          key={i}
          data-testid="evidence-highlight-overlay"
          className="pointer-events-none absolute rounded-[2px]"
          style={{
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            backgroundColor: "#FFF6DC",
            outline: "2px solid #F6B826",
            outlineOffset: "0px",
          }}
        />
      ))}
    </div>
  );
}
