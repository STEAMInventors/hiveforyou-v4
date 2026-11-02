"use client";

import {
  type GetHiveReportsResponse,
  type HiveReport,
  isActiveReportRunStatus,
  type ReportAudience,
} from "@hiveforyou/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { A2uiView } from "@/components/a2ui/A2uiView";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { DOCUMENT_READ_POLL_INTERVAL_MS } from "@/components/hives/document-read-progress";
import { coverageGapText } from "@/components/hives/study-preparation-progress";
import { HiveClientError } from "@/lib/hives-client";
import { fetchHiveReport, fetchHiveReports, generateHiveReport } from "@/lib/reports-client";

type ReportsPanelProps = {
  hiveId: string;
  initial: GetHiveReportsResponse;
};

const AUDIENCES: { key: ReportAudience; label: string; description: string }[] = [
  { key: "CUSTOMER", label: "Customer", description: "Plain-language answers for the person who asked." },
  { key: "PRO", label: "Pro", description: "Full detail for a specialist reviewing the same evidence." },
];

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

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
export function ReportsPanel({ hiveId, initial }: ReportsPanelProps) {
  const [state, setState] = useState(initial);
  const [audience, setAudience] = useState<ReportAudience>("CUSTOMER");
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
      <section className="flex flex-col gap-2 rounded-card border border-line bg-paper px-8 py-10" data-testid="reports-empty">
        <h2 className="m-0 font-brand text-[21px] font-medium text-ink">No reports yet</h2>
        <p className="m-0 text-[15px] leading-[1.55] text-ink-muted">
          Analyze your documents from the Documents tab. Both reports are written from the same checked study.
        </p>
      </section>
    );
  }

  const runActive = !!run && isActiveReportRunStatus(run.status);
  const runFailed = run?.status === "FAILED";

  return (
    <section aria-labelledby="reports-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="reports-title" className="m-0 font-brand text-[30px] font-semibold text-ink">
            Reports
          </h1>
          <p className="m-0 mt-1.5 text-[15px] text-ink-muted">
            From study revision {state.studyRevision.revisionNumber}
            {state.studyRevision.coverageStatus === "MATERIAL_GAPS"
              ? " · some content couldn't be read"
              : state.studyRevision.coverageStatus === "NONMATERIAL_GAPS"
                ? " · some pages had no text"
                : ""}
          </p>
          {state.studyRevision.coverageGaps.length > 0 ? (
            <details className="mt-2 text-[13.5px] text-ink-muted" data-testid="reports-limitations">
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
        </div>
        <div role="tablist" aria-label="Report audience" className="inline-flex rounded-control border border-line bg-paper p-1">
          {AUDIENCES.map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={audience === option.key}
              className={`rounded-[8px] px-4 py-1.5 text-[14px] font-medium ${
                audience === option.key ? "bg-cell-blue text-paper" : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => {
                setAudience(option.key);
                setActionError(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="-mt-2 mb-0 text-[14px] text-ink-subtle">{AUDIENCES.find((option) => option.key === audience)?.description}</p>

      {runActive ? (
        <p role="status" className="m-0 rounded-control bg-cell-blue-wash px-4 py-3 text-[14px] text-cell-blue-deep" data-testid="report-run-status">
          {run.attemptCount > 0 && run.status === "QUEUED"
            ? `Writing this report again (attempt ${run.attemptCount + 1} of ${run.maxAttempts}).`
            : "Writing this report from your study…"}
        </p>
      ) : null}
      {runFailed ? (
        <div role="alert" className="flex flex-col gap-1 rounded-control bg-coral-wash px-4 py-3 text-[14px] text-coral-deep" data-testid="report-run-status">
          <span>{run.errorMessageSafe ?? "This report couldn't be written."} Your study is safe; you can generate the report again.</span>
          <span className="font-mono text-[11px] text-ink-subtle">Support reference: {run.correlationId}</span>
        </div>
      ) : null}
      {actionError ? (
        <p role="alert" className="m-0 text-sm text-coral-deep">
          {actionError.message}
          {actionError.correlationId ? ` Support reference: ${actionError.correlationId}` : ""}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          className={runFailed || (!shown && !runActive) ? PRIMARY_BUTTON_CLASS : SECONDARY_BUTTON_CLASS}
          disabled={runActive || generating !== null}
          onClick={() => void generate()}
          data-testid="generate-again"
        >
          {generating === audience ? "Starting…" : "Generate again"}
        </button>
        {selected && selected.audience === audience && latest && selected.id !== latest.id ? (
          <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => setSelected(null)}>
            Back to latest
          </button>
        ) : null}
      </div>

      {shown ? (
        <article aria-label={shown.title} className="flex flex-col gap-4" data-testid="report-view">
          <header className="flex flex-col gap-1">
            <h2 className="m-0 font-brand text-[24px] font-semibold text-ink">{shown.title}</h2>
            <span className="text-[13px] text-ink-subtle">
              Written {dateFormat.format(new Date(shown.createdAt))} UTC · study revision {shown.revisionNumber}
            </span>
          </header>
          <A2uiView view={shown.view} />
        </article>
      ) : !runActive ? (
        <p className="m-0 rounded-card border border-dashed border-line px-6 py-8 text-center text-[15px] text-ink-muted">
          No {audience === "CUSTOMER" ? "Customer" : "Pro"} report for this study yet.
        </p>
      ) : null}

      {history.length > 1 ? (
        <section aria-labelledby="reports-history" className="flex flex-col gap-2 border-t border-line pt-4">
          <h2 id="reports-history" className="m-0 text-[15px] font-semibold text-ink">
            Earlier versions
          </h2>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {history.map((report) => (
              <li key={report.id}>
                <button
                  type="button"
                  className="w-full rounded-control px-3 py-2 text-left text-[14px] text-ink hover:bg-mist aria-[current=true]:bg-mist"
                  aria-current={shown?.id === report.id}
                  onClick={() => void open(report.id)}
                >
                  {report.title}
                  <span className="ml-2 text-[12.5px] text-ink-subtle">
                    {dateFormat.format(new Date(report.createdAt))} UTC · revision {report.revisionNumber}
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
