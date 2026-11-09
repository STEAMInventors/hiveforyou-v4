"use client";

import {
  type GetHiveReportsResponse,
  type HiveReport,
  isActiveReportRunStatus,
  isStudyViewReport,
  type ReportAudience,
} from "@hiveforyou/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { A2uiView } from "@/components/a2ui/A2uiView";
import { COMPACT_PRIMARY_BUTTON_CLASS, COMPACT_SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { DOCUMENT_READ_POLL_INTERVAL_MS } from "@/components/hives/document-read-progress";
import { ProgressElapsed } from "@/components/hives/progress-elapsed";
import { coverageGapText } from "@/components/hives/study-preparation-progress";
import { StudyReport } from "@/components/study/StudyReport";
import { StudyView } from "@/components/study/StudyView";
import { HiveClientError } from "@/lib/hives-client";
import { fetchHiveReport, fetchHiveReports, generateHiveReport } from "@/lib/reports-client";

type ReportsPanelProps = {
  hiveId: string;
  initial: GetHiveReportsResponse;
  initialAudience?: ReportAudience;
  /** Physical page count per document id, when known. */
  documentPages?: Readonly<Record<string, number>>;
};

const AUDIENCES: { key: ReportAudience; label: string; param: string; description: string }[] = [
  { key: "CUSTOMER", label: "Customer", param: "customer", description: "Plain-language answers for the person who asked." },
  { key: "PRO", label: "Pro", param: "pro", description: "Full detail for a specialist reviewing the same evidence." },
];

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

const CARD = "flex flex-col gap-4 rounded-card border border-line bg-paper p-5 sm:p-7";

type ActionError = { message: string; correlationId: string | null };

function toActionError(error: unknown, fallback: string): ActionError {
  return error instanceof HiveClientError
    ? { message: error.message, correlationId: error.correlationId || null }
    : { message: fallback, correlationId: null };
}

/**
 * Both reports of the accepted Study, freely readable. Each audience has its own Writer run: one
 * failing never hides the other, and "Generate again" reruns only that Writer, never the Study.
 */
export function ReportsPanel({ hiveId, initial, initialAudience = "CUSTOMER", documentPages }: ReportsPanelProps) {
  const [state, setState] = useState(initial);
  const [audience, setAudience] = useState<ReportAudience>(initialAudience);
  const [selected, setSelected] = useState<HiveReport | null>(null);
  const [generating, setGenerating] = useState<ReportAudience | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const working = state.reportRuns.some((run) => isActiveReportRunStatus(run.status));

  const refresh = useCallback(async () => {
    try {
      setState(await fetchHiveReports(hiveId));
    } catch {
      // keep the last good state; the next poll tries again
    }
  }, [hiveId]);

  useEffect(() => {
    if (!working) return;
    pollRef.current = setInterval(() => void refresh(), DOCUMENT_READ_POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [refresh, working]);

  const run = state.reportRuns.find((candidate) => candidate.audience === audience) ?? null;
  const latest = state.latest.find((report) => report.audience === audience) ?? null;
  const shown = selected && selected.audience === audience ? selected : latest;
  const history = state.history.filter((report) => report.audience === audience);

  const generate = async () => {
    if (!state.studyRevision || generating) return;
    setGenerating(audience);
    setActionError(null);
    try {
      await generateHiveReport(hiveId, {
        clientRequestId: crypto.randomUUID(),
        studyRevisionId: state.studyRevision.id,
        audience,
      });
      setSelected(null);
      await refresh();
    } catch (error) {
      setActionError(toActionError(error, "Could not start a new report. Try again."));
    } finally {
      setGenerating(null);
    }
  };

  const open = async (reportId: string) => {
    setActionError(null);
    try {
      setSelected(await fetchHiveReport(hiveId, reportId));
    } catch (error) {
      setActionError(toActionError(error, "Could not load this report."));
    }
  };

  if (!state.studyRevision) {
    return (
      <section className="flex flex-col gap-2 rounded-card border border-line bg-paper p-5 sm:p-7" data-testid="reports-empty">
        <h2 className="m-0 font-brand text-section font-semibold text-ink">No reports yet</h2>
        <p className="m-0 max-w-prose text-body text-graphite">
          Analyze your documents from the Documents tab. Both reports are written from the same checked study.
        </p>
      </section>
    );
  }

  const runActive = !!run && isActiveReportRunStatus(run.status);
  const runFailed = run?.status === "FAILED";

  const controls = (
    <>
      <nav aria-label="Report audience" className="inline-flex rounded-control border border-line bg-mist p-1">
        {AUDIENCES.map((option) => {
          const current = audience === option.key;
          return (
            <a
              key={option.key}
              href={`?audience=${option.param}`}
              aria-current={current ? "page" : undefined}
              className={`inline-flex min-h-9 items-center rounded-[9px] px-4 text-small font-medium no-underline max-sm:min-h-[44px] ${
                current ? "bg-cell-blue-deep text-paper" : "text-graphite hover:text-ink"
              }`}
              onClick={(event) => {
                event.preventDefault();
                setAudience(option.key);
                setActionError(null);
                window.history.replaceState(null, "", `?audience=${option.param}`);
              }}
            >
              {option.label}
            </a>
          );
        })}
      </nav>
      <div className="flex flex-wrap gap-2">
        {selected && selected.audience === audience && latest && selected.id !== latest.id ? (
          <button type="button" className={COMPACT_SECONDARY_BUTTON_CLASS} onClick={() => setSelected(null)}>
            Back to latest
          </button>
        ) : null}
        <button
          type="button"
          className={runFailed || (!shown && !runActive) ? COMPACT_PRIMARY_BUTTON_CLASS : COMPACT_SECONDARY_BUTTON_CLASS}
          disabled={runActive || generating !== null}
          onClick={() => void generate()}
          data-testid="generate-again"
        >
          {generating === audience ? "Starting…" : "Generate again"}
        </button>
      </div>
    </>
  );

  const status =
    runActive || runFailed || actionError ? (
      <div className="flex flex-col gap-2">
        {runActive ? (
          <div
            role="status"
            className="flex flex-col gap-2 rounded-control bg-needs-bg px-4 py-3 text-small text-needs-fg"
            data-testid="report-run-status"
          >
            <p className="m-0">
              {run.attemptCount > 0 && run.status === "QUEUED"
                ? `Writing this report again (attempt ${run.attemptCount + 1} of ${run.maxAttempts}).`
                : "Writing this report from your study…"}
            </p>
            <ProgressElapsed startedAt={run.createdAt} typicalRange="2–5 min" />
          </div>
        ) : null}
        {runFailed ? (
          <div role="alert" className="flex flex-col gap-1 rounded-control bg-missing-bg px-4 py-3 text-small text-missing-fg" data-testid="report-run-status">
            <span>{run.errorMessageSafe ?? "This report couldn't be written."} Your study is safe; you can generate the report again.</span>
            <span className="font-mono text-[11px] text-quiet">Support reference: {run.correlationId}</span>
          </div>
        ) : null}
        {actionError ? (
          <p role="alert" className="m-0 text-small text-missing-fg">
            {actionError.message}
            {actionError.correlationId ? ` Support reference: ${actionError.correlationId}` : ""}
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <section aria-label="Reports" className="flex flex-col gap-5">
      {state.studyRevision.format !== "canonical-study-1" ? (
        <StudyView hiveId={hiveId} revisionFormat={state.studyRevision.format} view={null} sources={null} />
      ) : null}

      {shown && isStudyViewReport(shown) ? (
        <article aria-label={shown.title} data-testid="report-view">
          <StudyReport
            key={`${shown.id}:${audience}`}
            hiveId={hiveId}
            view={shown.view}
            sources={shown.studyViewSources}
            header={{
              kind: "report",
              audience,
              fallbackTitle: shown.title,
              revisionNumber: shown.revisionNumber,
              writtenAt: shown.createdAt,
              currentRevisionNumber: state.studyRevision.revisionNumber,
            }}
            coverageGaps={state.studyRevision.coverageGaps}
            documentPages={documentPages}
            controls={controls}
            status={status}
          />
        </article>
      ) : (
        <>
          <header className={CARD}>
            <div className="flex flex-wrap items-center justify-between gap-3">{controls}</div>
            <p className="m-0 text-small text-quiet">
              {AUDIENCES.find((option) => option.key === audience)?.description} From study revision{" "}
              {state.studyRevision.revisionNumber}.
            </p>
            {state.studyRevision.coverageGaps.length > 0 ? (
              <details className="text-small text-graphite" data-testid="reports-limitations">
                <summary className="cursor-pointer">Limitations of this study</summary>
                <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
                  {state.studyRevision.coverageGaps.map((gap) => (
                    <li key={gap.key}>
                      <span className="font-medium text-ink">{gap.fileName}</span> — {coverageGapText(gap)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {status}
          </header>
          {shown ? (
            <article aria-label={shown.title} className="flex flex-col gap-4" data-testid="report-view">
              <header className="flex flex-col gap-1">
                <h2 className="m-0 font-brand text-title font-semibold text-ink">{shown.title}</h2>
                <span className="text-caption text-quiet">
                  Written <span className="font-brand">{dateFormat.format(new Date(shown.createdAt))}</span> UTC · study revision{" "}
                  {shown.revisionNumber}
                </span>
              </header>
              <A2uiView view={shown.view} />
            </article>
          ) : !runActive ? (
            <p className="m-0 rounded-card border border-dashed border-line bg-paper px-6 py-8 text-center text-body text-graphite">
              No {audience === "CUSTOMER" ? "Customer" : "Pro"} report for this study yet.
            </p>
          ) : null}
        </>
      )}

      {history.length > 1 ? (
        <section aria-labelledby="reports-history" className={CARD}>
          <h2 id="reports-history" className="m-0 font-brand text-section font-semibold text-ink">
            Earlier versions
          </h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {history.map((report) => (
              <li key={report.id}>
                <button
                  type="button"
                  className="min-h-11 w-full rounded-control px-3 py-2 text-left text-small text-ink hover:bg-mist aria-[current=true]:bg-mist"
                  aria-current={shown?.id === report.id}
                  onClick={() => void open(report.id)}
                >
                  {report.title}
                  <span className="ml-2 text-caption text-quiet">
                    <span className="font-brand">{dateFormat.format(new Date(report.createdAt))}</span> UTC · revision{" "}
                    {report.revisionNumber}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
