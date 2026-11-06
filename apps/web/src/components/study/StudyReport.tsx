"use client";

import type {
  CoverageGap,
  ReportAudience,
  StudyView,
  StudyViewBlockName,
  StudyViewRow,
  StudyViewSourceRef,
  StudyViewSources,
} from "@hiveforyou/contracts";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from "react";

import { hiveDocumentsPath } from "@/lib/hive-routes";

import { ComparisonCard } from "./ComparisonCard";
import { HiveMark } from "./HiveMark";
import { DocumentsTable } from "./DocumentsTable";
import { EstablishTable } from "./EstablishTable";
import { EvidenceViewerProvider } from "./EvidenceViewer";
import { InferenceLabel } from "./InferenceLabel";
import { groupMissing, isStructuralNote, MissingList, missingCount } from "./MissingList";
import { ReadProblemNotice, readProblemsFromCoverage } from "./ReadProblemNotice";
import { ReportFooter } from "./ReportFooter";
import { type ChipRef, shortDocumentLabels, SourceChips } from "./SourceChip";
import { countStates, spineRowState, StateBar } from "./StateBar";
import { STUDY_SECTION_IDS, studyStateTargets } from "./study-summary";
import { formatDocumentDate, rowChips, selectUpcoming, Timeline } from "./Timeline";

export type StudyReportHeader =
  | {
      readonly kind: "report";
      readonly audience: ReportAudience;
      readonly fallbackTitle: string;
      readonly revisionNumber: number;
      readonly writtenAt: string;
      /** Hive's current accepted revision; when equal to `revisionNumber`, in-card StateBar is hidden. */
      readonly currentRevisionNumber?: number | null;
    }
  | { readonly kind: "study"; readonly revisionNumber: number | null };

type StudyReportProps = {
  hiveId: string;
  view: StudyView;
  sources: StudyViewSources | null;
  header: StudyReportHeader;
  coverageGaps?: readonly CoverageGap[];
  /** Physical page count per document id, when known. */
  documentPages?: Readonly<Record<string, number>>;
  /** Audience switch and "Generate again", shown at the top of the header card. */
  controls?: ReactNode;
  /** Run progress or errors, shown inside the header card. */
  status?: ReactNode;
  /** Off when the page header already shows this study's state bar. */
  showStateBar?: boolean;
};

const SECTION_IDS = STUDY_SECTION_IDS;

const DETAIL_SECTION_IDS: ReadonlySet<string> = new Set([SECTION_IDS.establish, SECTION_IDS.timeline, SECTION_IDS.documents]);

const CARD = "flex flex-col rounded-card border border-line bg-paper p-5 sm:p-7";
const SECTION_HEADING = "m-0 font-brand text-section font-semibold text-ink";

const writtenFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The first sentence of the owner's intent, sentence case, at most 120 characters. */
export function titleFromIntent(intent: string | undefined): string | null {
  const text = intent?.replace(/\s+/g, " ").trim() ?? "";
  if (text === "") return null;
  const first = text.split(/(?<=[.?!])\s/)[0] ?? text;
  const short = first.length <= 120 ? first : `${first.slice(0, first.lastIndexOf(" ", 117) > 60 ? first.lastIndexOf(" ", 117) : 117)}…`;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

const refChip = (ref: StudyViewSourceRef): ChipRef => ({
  sourceDocumentId: ref.sourceDocumentId,
  pageNumber: ref.pageNumber,
  quote: ref.quote,
});

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/**
 * One layout for both reports and the study view. Every count, label and calculation is made here
 * from the canonical study; the write output contributes only the narrative sections.
 */
export function StudyReport({ hiveId, view, sources, header, coverageGaps = [], documentPages, controls, status, showStateBar = true }: StudyReportProps) {
  const customer = header.kind === "report" && header.audience === "CUSTOMER";
  const isReport = header.kind === "report";
  const [detailsOpen, setDetailsOpen] = useState(!customer);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const detailsId = useId();

  const pageCountFor = useCallback(
    (id: string) => documentPages?.[id] ?? documentPages?.[id.toLowerCase()],
    [documentPages],
  );

  const model = useMemo(() => {
    const rows = (name: StudyViewBlockName): readonly StudyViewRow[] => view.blocks.find((block) => block.name === name)?.rows ?? [];
    const documents = rows("documents");
    const labels = shortDocumentLabels(
      documents.map((row) => ({ sourceDocumentId: row.id, typeInPlainWords: row.typeInPlainWords, date: row.date })),
    );
    const readProblems = readProblemsFromCoverage(coverageGaps, (id) => labels.get(id), pageCountFor);
    const gaps = rows("gaps");
    const missing = groupMissing(gaps, readProblems, view.spineSource);
    const spine = rows("spine_table");
    const timeline = rows("timeline");
    const conflicts = rows("conflicts");
    const documentDate = new Map(documents.map((row) => [row.id, row.date ?? null]));
    return {
      documents,
      labels,
      readProblems,
      missing,
      structuralNote: gaps[0] && isStructuralNote(gaps[0], 0, view.spineSource) ? gaps[0] : null,
      spine,
      outsideSpine: rows("outside_spine"),
      timeline,
      conflicts,
      counts: countStates(spine, missingCount(missing)),
      upcoming: selectUpcoming(timeline, documents.map((row) => row.date)),
      needsRows: spine.filter((row) => spineRowState(row) === "needs"),
      documentDate: (id: string) => documentDate.get(id) ?? null,
      unreadableIds: new Set(readProblems.filter((problem) => problem.wholeDocument).map((problem) => problem.sourceDocumentId)),
    };
  }, [view, coverageGaps, pageCountFor]);

  const navigate = useCallback(
    (sectionId: string) => {
      if (DETAIL_SECTION_IDS.has(sectionId) && !detailsOpen) setDetailsOpen(true);
      setPendingScroll(sectionId);
    },
    [detailsOpen],
  );

  useEffect(() => {
    if (!pendingScroll) return;
    const target = document.getElementById(pendingScroll);
    if (target) {
      target.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      target.focus({ preventScroll: true });
      window.history.replaceState(null, "", `#${pendingScroll}`);
    }
    setPendingScroll(null);
  }, [pendingScroll, reducedMotion]);

  const sentenceChips = (factIds: readonly string[]): ChipRef[] =>
    factIds.flatMap((id) => {
      const ref = sources?.facts[id];
      return ref ? [refChip(ref)] : [];
    });

  const title =
    titleFromIntent(view.intent) ?? (header.kind === "report" ? header.fallbackTitle : "What the documents show");
  const meta =
    header.kind === "report" ? (
      <span className="inline-flex flex-col gap-1">
        <span className="inline-flex flex-wrap items-center gap-2">
          <HiveMark />
          <span>
            {header.audience === "CUSTOMER" ? "Customer" : "Pro"} report · From study revision {header.revisionNumber} · Written{" "}
            <span className="font-brand">{writtenFormat.format(new Date(header.writtenAt))}</span>
          </span>
        </span>
        {header.currentRevisionNumber != null && header.revisionNumber !== header.currentRevisionNumber ? (
          <span className="text-caption text-quiet">As of revision {header.revisionNumber}</span>
        ) : null}
      </span>
    ) : header.revisionNumber !== null ? (
      <span className="inline-flex flex-wrap items-center gap-2">
        <HiveMark />
        <span>From study revision {header.revisionNumber}</span>
      </span>
    ) : null;

  const stateTargets = studyStateTargets(view);

  const glanceRows: { label: string; content: ReactNode }[] = [];
  if (isReport && model.upcoming) {
    const upcoming = model.upcoming;
    glanceRows.push({
      label: "Upcoming in the documents",
      content: (
        <>
          <span className="font-brand font-semibold">{formatDocumentDate(upcoming.date)}</span> · {upcoming.statement}{" "}
          <SourceChips refs={rowChips(upcoming)} />
        </>
      ),
    });
  }
  if (isReport && model.conflicts[0]) {
    const first = model.conflicts[0];
    glanceRows.push({
      label: "Where documents disagree",
      content: (
        <>
          {first.statement} <SourceChips refs={rowChips(first)} />
        </>
      ),
    });
  }
  if (isReport && model.needsRows.length > 0) {
    glanceRows.push({
      label: "Open items",
      content: (
        <>
          <span className="font-semibold">{model.needsRows.length}</span>
          <ul className="m-0 mt-1 flex list-disc flex-col gap-0.5 pl-5 marker:text-quiet">
            {model.needsRows.map((row) => (
              <li key={row.id}>{row.label}</li>
            ))}
          </ul>
        </>
      ),
    });
  }

  const narrative = isReport ? view.sections : [];
  const hasEstablish = model.spine.length > 0 || model.outsideSpine.length > 0 || !!model.structuralNote;
  const hasMissing = missingCount(model.missing) > 0;

  const toc: { id: string; label: string }[] = [
    ...(glanceRows.length > 0 ? [{ id: SECTION_IDS.glance, label: "At a glance" }] : []),
    ...narrative.map((section, index) => ({ id: `narrative-${index + 1}`, label: section.heading })),
    ...(model.conflicts.length > 0 ? [{ id: SECTION_IDS.disagree, label: "Where the documents disagree" }] : []),
    ...(!customer && hasEstablish ? [{ id: SECTION_IDS.establish, label: "What the documents establish" }] : []),
    ...(hasMissing ? [{ id: SECTION_IDS.missing, label: "What is missing" }] : []),
    ...(customer && hasEstablish ? [{ id: SECTION_IDS.establish, label: "What the documents establish" }] : []),
    ...(model.timeline.length > 0 ? [{ id: SECTION_IDS.timeline, label: "Timeline" }] : []),
    ...(model.documents.length > 0 ? [{ id: SECTION_IDS.documents, label: "Documents" }] : []),
  ];

  const pageGap = customer ? "gap-6" : "gap-4";
  const cardGap = customer ? "gap-5" : "gap-4";

  const establishCard = hasEstablish ? (
    <section id={SECTION_IDS.establish} tabIndex={-1} aria-labelledby={`${SECTION_IDS.establish}-h`} className={`${CARD} ${cardGap}`}>
      <h3 id={`${SECTION_IDS.establish}-h`} className={SECTION_HEADING}>
        What the documents establish
      </h3>
      {model.structuralNote ? <p className="m-0 max-w-prose text-body text-graphite">{model.structuralNote.statement}</p> : null}
      {model.spine.length > 0 ? <EstablishTable rows={model.spine} compact={!customer} /> : null}
      {model.outsideSpine.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="m-0 text-small font-semibold text-ink">Also in the documents</h4>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {model.outsideSpine.map((row) => (
              <li key={row.id} className="max-w-prose text-body text-ink" data-row-id={row.id}>
                {row.statement} <SourceChips refs={rowChips(row)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  ) : null;

  const timelineCard =
    model.timeline.length > 0 ? (
      <section id={SECTION_IDS.timeline} tabIndex={-1} aria-labelledby={`${SECTION_IDS.timeline}-h`} className={`${CARD} ${cardGap}`}>
        <h3 id={`${SECTION_IDS.timeline}-h`} className={SECTION_HEADING}>
          Timeline
        </h3>
        <Timeline rows={model.timeline} upcomingId={model.upcoming?.id ?? null} />
      </section>
    ) : null;

  const documentsCard =
    model.documents.length > 0 ? (
      <section id={SECTION_IDS.documents} tabIndex={-1} aria-labelledby={`${SECTION_IDS.documents}-h`} className={`${CARD} ${cardGap}`}>
        <h3 id={`${SECTION_IDS.documents}-h`} className={SECTION_HEADING}>
          Documents
        </h3>
        <DocumentsTable rows={model.documents} unreadableIds={model.unreadableIds} pageCountFor={pageCountFor} />
      </section>
    ) : null;

  return (
    <EvidenceViewerProvider hiveId={hiveId} labels={model.labels} fileNames={sources?.documents ?? {}}>
      <div className="flex flex-wrap items-start gap-6" data-testid="study-view" data-audience={isReport ? header.audience : "STUDY"}>
        <div className={`flex min-w-0 flex-[999_1_640px] flex-col ${pageGap}`}>
          <header className={`${CARD} gap-4`} data-testid="report-header">
            {controls ? <div className="flex flex-wrap items-center justify-between gap-3">{controls}</div> : null}
            <div className="flex flex-col gap-1.5">
              <h2 className="m-0 font-brand text-title font-semibold text-ink">{title}</h2>
              {meta ? <p className="m-0 text-small text-quiet">{meta}</p> : null}
            </div>
            {view.intent ? (
              <p className="m-0 max-w-prose text-body text-graphite">
                <span className="font-medium text-ink">You asked:</span>{" "}
                <span className="font-quote italic">{view.intent}</span>
              </p>
            ) : null}
            {showStateBar && !(header.kind === "report" && header.currentRevisionNumber === header.revisionNumber) ? (
              <StateBar counts={model.counts} targets={stateTargets} onNavigate={navigate} />
            ) : null}
            {status}
          </header>

          <ReadProblemNotice problems={model.readProblems} documentsHref={hiveDocumentsPath(hiveId)} />

          {glanceRows.length > 0 ? (
            <section id={SECTION_IDS.glance} tabIndex={-1} aria-labelledby={`${SECTION_IDS.glance}-h`} className={`${CARD} ${cardGap}`}>
              <h3 id={`${SECTION_IDS.glance}-h`} className={SECTION_HEADING}>
                At a glance
              </h3>
              <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                {glanceRows.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="text-small text-quiet">{row.label}</dt>
                    <dd className="m-0 max-w-prose text-body text-ink max-sm:-mt-3">{row.content}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {narrative.map((section, sectionIndex) => (
            <section
              key={`narrative-${sectionIndex + 1}`}
              id={`narrative-${sectionIndex + 1}`}
              tabIndex={-1}
              className={`${CARD} ${customer ? "gap-4" : "gap-3"}`}
              data-testid="study-view-section"
            >
              <h3 className={SECTION_HEADING}>{section.heading}</h3>
              {section.paragraphs.map((paragraph, paragraphIndex) => (
                <p key={paragraphIndex} className="m-0 max-w-prose text-body text-ink">
                  {paragraph.sentences.map((sentence, sentenceIndex) => {
                    const chips = sentenceChips(sentence.factIds);
                    if (chips.length === 0) return null;
                    return (
                      <span key={sentenceIndex} data-testid="study-sentence">
                        <InferenceLabel />
                        {sentence.text} <SourceChips refs={chips} />{" "}
                      </span>
                    );
                  })}
                </p>
              ))}
            </section>
          ))}

          {model.conflicts.length > 0 ? (
            <section id={SECTION_IDS.disagree} tabIndex={-1} aria-labelledby={`${SECTION_IDS.disagree}-h`} className={`flex flex-col ${cardGap}`}>
              <h3 id={`${SECTION_IDS.disagree}-h`} className={`${SECTION_HEADING} px-1`}>
                Where the documents disagree
              </h3>
              {model.conflicts.map((row) => (
                <ComparisonCard key={row.id} row={row} documentDate={model.documentDate} />
              ))}
            </section>
          ) : null}

          {!customer ? establishCard : null}

          {hasMissing ? (
            <section id={SECTION_IDS.missing} tabIndex={-1} aria-labelledby={`${SECTION_IDS.missing}-h`} className={`${CARD} ${cardGap}`}>
              <h3 id={`${SECTION_IDS.missing}-h`} className={SECTION_HEADING}>
                What is missing
              </h3>
              <MissingList groups={model.missing} />
            </section>
          ) : null}

          {customer ? (
            establishCard || timelineCard || documentsCard ? (
              <>
                <button
                  type="button"
                  aria-expanded={detailsOpen}
                  aria-controls={detailsId}
                  onClick={() => setDetailsOpen((open) => !open)}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-control border border-line bg-paper px-4 text-body font-medium text-ink hover:bg-mist"
                  data-testid="see-details"
                >
                  {detailsOpen ? "Hide the details" : "See the details"}
                </button>
                <div id={detailsId} hidden={!detailsOpen} className={`${detailsOpen ? "flex" : "hidden"} flex-col ${pageGap}`}>
                  {establishCard}
                  {timelineCard}
                  {documentsCard}
                </div>
              </>
            ) : null
          ) : (
            <>
              {timelineCard}
              {documentsCard}
            </>
          )}

          <ReportFooter />
        </div>

        {toc.length > 1 ? (
          <aside className="flex-[1_1_240px] md:sticky md:top-[88px]" aria-label="On this page">
            <nav className={`${CARD} gap-3`}>
              <h2 className="m-0 text-caption font-semibold text-quiet">On this page</h2>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="flex min-h-9 items-center rounded-chip px-2 text-small text-graphite no-underline hover:bg-mist hover:text-ink max-sm:min-h-[44px]"
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(item.id);
                      }}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        ) : null}
      </div>
    </EvidenceViewerProvider>
  );
}
