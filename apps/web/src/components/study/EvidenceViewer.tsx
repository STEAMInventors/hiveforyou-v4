"use client";

import type {
  CanonicalStudy,
  CoverageGap,
  FindingsOpenItem,
  FindingsTopic,
  StudyView,
  StudyViewSources,
} from "@hiveforyou/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type ComponentType,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { buildEvidenceStatementModel } from "@/components/study/evidence-statement-model";
import { EvidenceViewPanel } from "@/components/study/EvidenceViewPanel";
import { readProblemsFromCoverage, type ReadProblem } from "@/components/study/ReadProblemNotice";
import {
  EVIDENCE_ITEM_PARAM,
  EVIDENCE_SOURCE_PARAM,
  formatEvidenceSource,
  parseEvidenceSource,
} from "@/lib/evidence-source-query";
import { documentPageTextPath, evidenceViewerOpenPath, postViewerOpenInit } from "@/lib/evidence-view-urls";
import { hiveSectionFromPathname, preservedQuery } from "@/lib/hive-routes";
import { isHttpOrHttpsUrlString, signedUrlShapeForLog } from "@/lib/signed-url-log-shape";

import { type CitationContext, type SiblingPageTarget } from "./citation-context";
import type { EvidenceHighlightStatus, EvidencePdfPageProps } from "./EvidencePdfPage";
import { loadEvidencePdfPage } from "./load-evidence-pdf-page";
import { type ChipRef } from "./SourceChip";

export type EvidenceOpenOptions = {
  readonly itemId?: string | null;
  readonly syncUrl?: boolean;
};

type EvidenceViewerValue = {
  readonly labelFor: (sourceDocumentId: string) => string;
  readonly chipLabelFor: (sourceDocumentId: string) => string;
  readonly open: (chip: ChipRef, trigger?: HTMLElement | null, options?: EvidenceOpenOptions) => void;
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
  chipLabels?: ReadonlyMap<string, string>;
  pageCountFor?: (sourceDocumentId: string) => number | undefined;
  citationContexts?: ReadonlyMap<string, readonly { context: CitationContext; siblings: readonly SiblingPageTarget[] }[]>;
  readCoverageLines?: ReadonlyMap<string, string>;
  view?: StudyView | null;
  sources?: StudyViewSources | null;
  canonicalStudy?: CanonicalStudy | null;
  openItems?: readonly FindingsOpenItem[];
  topics?: readonly FindingsTopic[];
  coverageGaps?: readonly CoverageGap[];
  clientFirstName?: string | null;
  staffOnFirmHive?: boolean;
  children: ReactNode;
};

function chipMapKey(sourceDocumentId: string, pageNumber: number): string {
  return `${sourceDocumentId}:${pageNumber}`;
}

function backTabLabel(pathname: string, hiveId: string): string {
  const section = hiveSectionFromPathname(pathname, hiveId);
  if (section === "documents") return "Documents";
  if (section === "reports") return "Report";
  if (section === "audit") return "Audit trail";
  if (section === "notes") return "Team notes";
  if (section === "findings") return "Home";
  return "Home";
}

function chipFromUrl(
  parsed: { sourceDocumentId: string; pageNumber: number },
  sources: StudyViewSources | null | undefined,
): ChipRef {
  if (!sources) {
    return { sourceDocumentId: parsed.sourceDocumentId, pageNumber: parsed.pageNumber };
  }
  const match = Object.entries(sources.facts).find(
    ([, ref]) =>
      ref.sourceDocumentId === parsed.sourceDocumentId && ref.pageNumber === parsed.pageNumber,
  );
  if (!match) {
    return { sourceDocumentId: parsed.sourceDocumentId, pageNumber: parsed.pageNumber };
  }
  const [factId, ref] = match;
  return {
    sourceDocumentId: ref.sourceDocumentId,
    pageNumber: ref.pageNumber,
    quote: ref.quote,
    factIds: [factId],
  };
}

function searchParamsRecord(search: URLSearchParams): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  search.forEach((value, key) => {
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  });
  return out;
}

function unreadableForPage(
  problems: readonly ReadProblem[],
  sourceDocumentId: string,
  pageNumber: number,
): ReadProblem | null {
  const key = sourceDocumentId.toLowerCase();
  for (const problem of problems) {
    if (problem.sourceDocumentId.toLowerCase() !== key) continue;
    if (problem.wholeDocument || problem.pageNumbers.includes(pageNumber)) return problem;
  }
  return null;
}

export function EvidenceViewerProvider({
  hiveId,
  labels,
  chipLabels,
  pageCountFor = () => undefined,
  citationContexts = new Map(),
  readCoverageLines = new Map(),
  view = null,
  sources = null,
  canonicalStudy = null,
  openItems = [],
  topics = [],
  coverageGaps = [],
  clientFirstName = null,
  staffOnFirmHive = false,
  children,
}: EvidenceViewerProviderProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();

  const [state, setState] = useState<{ chip: ChipRef; pageNumber: number } | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [pageText, setPageText] = useState<string | null>(null);
  const [pageMime, setPageMime] = useState<string | null>(null);
  const [vaultMime, setVaultMime] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [highlightStatus, setHighlightStatus] = useState<EvidenceHighlightStatus | null>(null);
  const [neighborPageText, setNeighborPageText] = useState<string | null>(null);
  const [PdfViewer, setPdfViewer] = useState<ComponentType<EvidencePdfPageProps> | null>(null);
  const [pdfViewerLoadError, setPdfViewerLoadError] = useState(false);
  const announceRef = useRef<HTMLDivElement | null>(null);

  const labelFor = useCallback((id: string) => labels.get(id) ?? labels.get(id.toLowerCase()) ?? "Document", [labels]);
  const chipLabelFor = useCallback(
    (id: string) => chipLabels?.get(id) ?? chipLabels?.get(id.toLowerCase()) ?? labels.get(id) ?? "Document",
    [chipLabels, labels],
  );

  const readProblems = useMemo(
    () => readProblemsFromCoverage(coverageGaps, (id) => chipLabelFor(id), pageCountFor),
    [coverageGaps, chipLabelFor, pageCountFor],
  );

  const pushUrl = useCallback(
    (chip: ChipRef, nextItemId: string | null) => {
      const params: Record<string, string | null> = {
        [EVIDENCE_SOURCE_PARAM]: formatEvidenceSource(chip),
        [EVIDENCE_ITEM_PARAM]: nextItemId,
      };
      const query = preservedQuery(searchParamsRecord(searchParams), params);
      router.push(`${pathname}${query}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const resetLoads = useCallback(() => {
    setSignedUrl(null);
    setPageText(null);
    setPageMime(null);
    setVaultMime(null);
    setLoadError(null);
    setHighlightStatus(null);
    setNeighborPageText(null);
    setPdfViewer(null);
    setPdfViewerLoadError(false);
  }, []);

  const open = useCallback(
    (next: ChipRef, trigger?: HTMLElement | null, options?: EvidenceOpenOptions) => {
      triggerRef.current = trigger ?? null;
      resetLoads();
      const nextItemId = options?.itemId ?? null;
      setItemId(nextItemId);
      setState({ chip: next, pageNumber: next.pageNumber });
      if (options?.syncUrl !== false) {
        pushUrl(next, nextItemId);
      }
    },
    [pushUrl, resetLoads],
  );

  const close = useCallback(() => {
    setState(null);
    setItemId(null);
    resetLoads();
    const query = preservedQuery(searchParamsRecord(searchParams), {
      [EVIDENCE_SOURCE_PARAM]: null,
      [EVIDENCE_ITEM_PARAM]: null,
    });
    router.push(`${pathname}${query}`, { scroll: false });
    triggerRef.current?.focus();
  }, [pathname, resetLoads, router, searchParams]);

  const urlSource = searchParams.get(EVIDENCE_SOURCE_PARAM);
  const urlItem = searchParams.get(EVIDENCE_ITEM_PARAM);

  useEffect(() => {
    const parsed = parseEvidenceSource(urlSource);
    if (!parsed) {
      setState((current) => {
        if (!current) return current;
        resetLoads();
        setItemId(null);
        return null;
      });
      return;
    }
    setState((current) => {
      const same =
        current?.chip.sourceDocumentId === parsed.sourceDocumentId &&
        current.pageNumber === parsed.pageNumber;
      setItemId(urlItem);
      if (same) return current;
      resetLoads();
      return { chip: chipFromUrl(parsed, sources), pageNumber: parsed.pageNumber };
    });
  }, [urlSource, urlItem, sources, resetLoads]);

  const chip = state?.chip ?? null;
  const pageNumber = state?.pageNumber ?? 1;
  const totalPages = chip
    ? (() => {
        const n = pageCountFor(chip.sourceDocumentId);
        return typeof n === "number" && n >= 1 ? n : 1;
      })()
    : 1;

  const docLabel = chip ? chipLabelFor(chip.sourceDocumentId) : "Document";
  const docSub = useMemo(() => {
    if (!chip || !view) return null;
    const row = view.blocks
      .find((block) => block.name === "documents")
      ?.rows.find((entry) => entry.id.toLowerCase() === chip.sourceDocumentId.toLowerCase());
    return row?.typeInPlainWords?.trim() || row?.date?.trim() || null;
  }, [chip, view]);

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
  const quoteForHighlight = primaryContext?.verifiedQuote ?? chip?.quote ?? "";
  const effectiveMime = vaultMime ?? pageMime;
  const mimeKind = viewerMimeCategory(effectiveMime);
  const isPdf = mimeKind === "pdf";
  const isImage = mimeKind === "image";

  const statement = useMemo(() => {
    if (!chip) return null;
    return buildEvidenceStatementModel({
      chip,
      itemId,
      primaryContext,
      view,
      sources,
      canonicalStudy,
      openItems,
      topics,
      coverageGaps,
      readProblems,
      chipLabelFor,
    });
  }, [
    chip,
    itemId,
    primaryContext,
    view,
    sources,
    canonicalStudy,
    openItems,
    topics,
    coverageGaps,
    readProblems,
    chipLabelFor,
  ]);

  const unreadableProblem = chip ? unreadableForPage(readProblems, chip.sourceDocumentId, pageNumber) : null;

  useEffect(() => {
    if (!chip) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chip, close]);

  useEffect(() => {
    if (!chip || unreadableProblem) return;
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
  }, [chip, hiveId, pageNumber, totalPages, unreadableProblem]);

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

  const onPageChange = useCallback(
    (nextPage: number) => {
      if (!chip) return;
      const next = { ...chip, pageNumber: nextPage };
      open(next, null, { itemId, syncUrl: true });
    },
    [chip, itemId, open],
  );

  const onOpenChip = useCallback(
    (nextChip: ChipRef) => {
      open(nextChip, null, { itemId, syncUrl: true });
    },
    [itemId, open],
  );

  const value = useMemo(() => ({ labelFor, chipLabelFor, open }), [labelFor, chipLabelFor, open]);
  const backLabel = backTabLabel(pathname, hiveId);

  return (
    <EvidenceViewerContext.Provider value={value}>
      <div className={chip ? "hidden" : undefined} aria-hidden={chip ? true : undefined}>
        {children}
      </div>
      {chip && statement ? (
        <EvidenceViewPanel
          hiveId={hiveId}
          backLabel={backLabel}
          docRole={docLabel}
          docSub={docSub}
          pageNumber={pageNumber}
          totalPages={totalPages}
          statement={statement}
          chip={chip}
          signedUrl={signedUrl}
          pageText={pageText}
          loadError={loadError}
          pdfViewerLoadError={pdfViewerLoadError}
          highlightStatusLine={highlightStatusLine}
          quoteForHighlight={quoteForHighlight}
          isPdf={isPdf}
          isImage={isImage}
          PdfViewer={PdfViewer}
          neighborPageText={neighborPageText}
          originalPageHref={originalPageHref}
          onHighlightStatus={onHighlightStatus}
          onPageChange={onPageChange}
          onOpenChip={onOpenChip}
          onClose={close}
          showAskClient={staffOnFirmHive}
          clientFirstName={clientFirstName}
          unreadableProblem={unreadableProblem}
        />
      ) : null}
      <div ref={announceRef} className="sr-only" role="status" aria-live="polite" aria-atomic="true" />
    </EvidenceViewerContext.Provider>
  );
}