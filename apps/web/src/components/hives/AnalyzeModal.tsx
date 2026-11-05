"use client";

import {
  type CoverageGap,
  documentsToRead,
  knownGapsToAcknowledge,
  knownLimitations,
  type ProcessingRun,
  type ReportRun,
  type StudyPreparationEligibility,
  type StudyRevisionSummary,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useEffect, useId, useRef } from "react";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { handleModalTabKeyDown, safeReturnFocus } from "@/lib/a11y/modal-focus";
import { usePrefersReducedMotion } from "@/lib/a11y/reduced-motion";
import { hiveReportsPath, hiveStudyPath } from "@/lib/hive-routes";

import type { ReadPollState } from "./document-read-progress";
import { HoneycombActivity, type LivingHiveMode } from "./HoneycombActivity";
import {
  coverageGapText,
  preparationCopy,
  preparationOutcome,
  preparationSteps,
  type ReportRowState,
  reportRows,
} from "./study-preparation-progress";
import type { AnalyzeModalMode, AnalyzeStartError } from "./useStudyPreparation";

type AnalyzeModalProps = {
  hiveId: string;
  mode: AnalyzeModalMode | null;
  action: "analyze" | "rebuild";
  run: ProcessingRun | null;
  studyRevision: StudyRevisionSummary | null;
  reportRuns: readonly ReportRun[];
  eligibility: StudyPreparationEligibility | null;
  pollState: ReadPollState;
  starting: boolean;
  startError: AnalyzeStartError | null;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onConfirm: () => void;
  onAcknowledge: () => void;
  onRetry: () => void;
};

const STEP_BAR: Record<string, string> = {
  done: "bg-leaf",
  active: "bg-cell-blue",
  stopped: "bg-line-strong",
  pending: "bg-line",
};

const REPORT_BADGE: Record<ReportRowState, string> = {
  pending: "bg-mist text-ink-muted",
  active: "bg-cell-blue-wash text-cell-blue-deep",
  retrying: "bg-honey-wash text-honey-deep",
  ready: "bg-leaf-wash text-leaf-deep",
  failed: "bg-coral-wash text-coral-deep",
};

const REPORT_BADGE_TEXT: Record<ReportRowState, string> = {
  pending: "Waiting",
  active: "Writing",
  retrying: "Retrying",
  ready: "Ready",
  failed: "Not written",
};

function GapList({ label, gaps, testId }: { label: string; gaps: readonly CoverageGap[]; testId: string }) {
  if (gaps.length === 0) return null;
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col overflow-hidden rounded-[14px] border border-line p-0" data-testid={testId}>
      {gaps.map((gap) => (
        <li key={gap.key} className="flex flex-col gap-0.5 border-b border-line px-4 py-3 last:border-b-0">
          <span className="truncate text-[14.5px] font-medium text-ink" title={gap.fileName}>
            {gap.fileName}
          </span>
          <span className={`text-[13px] ${gap.material ? "text-coral-deep" : "text-ink-muted"}`}>{coverageGapText(gap)}</span>
        </li>
      ))}
    </ul>
  );
}

export function AnalyzeModal(props: AnalyzeModalProps) {
  if (!props.mode) return null;
  if (props.mode === "progress" && !props.run && !props.startError) return null;
  return <AnalyzeDialog {...props} />;
}

function AnalyzeDialog({
  hiveId,
  mode,
  action,
  run,
  studyRevision,
  reportRuns,
  eligibility,
  pollState,
  starting,
  startError,
  returnFocusRef,
  onClose,
  onConfirm,
  onAcknowledge,
  onRetry,
}: AnalyzeModalProps) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const confirming = mode === "confirm";
  const outcome = confirming ? "idle" : preparationOutcome(run);
  const active = outcome === "active";
  const awaiting = outcome === "awaiting";
  const toRead = confirming && eligibility ? documentsToRead(eligibility) : [];
  const runGaps = !confirming && run ? run.coverageGaps : [];
  const missing = confirming && eligibility ? knownGapsToAcknowledge(eligibility) : awaiting ? runGaps.filter((gap) => gap.material) : [];
  const limitations =
    confirming && eligibility
      ? knownLimitations(eligibility)
      : awaiting
        ? runGaps.filter((gap) => !gap.material)
        : outcome === "succeeded"
          ? runGaps
          : [];
  const copy = confirming
    ? action === "rebuild"
      ? {
          title: "Some content is missing",
          sub: "Rebuild uses only the pages already saved. Review what's missing before you continue. Reports are not regenerated.",
        }
      : {
          title: "Some content is missing",
          sub:
            toRead.length > 0
              ? "The analysis will use only what was read. Documents not read yet are read first; if more is missing then, you'll review it before the analysis continues."
              : "The analysis will use only what was read. Review what's missing before you continue.",
        }
    : preparationCopy(run);
  const steps = preparationSteps(confirming ? null : run);
  const rebuilding = run?.preparationMode === "REBUILD" || (confirming && action === "rebuild");
  const acceptedRebuild =
    !confirming && outcome === "succeeded" && run?.preparationMode === "REBUILD" && studyRevision?.processingRunId === run.id
      ? studyRevision
      : null;
  const reports = !confirming && outcome === "succeeded" && !rebuilding ? reportRows(reportRuns) : [];
  const anyReportReady = reports.some((row) => row.state === "ready");
  const livingMode: LivingHiveMode =
    outcome === "succeeded"
      ? "success"
      : outcome === "failed"
        ? "failed"
        : outcome === "needs_clarification" || awaiting
          ? "still"
          : "processing";

  const close = () => {
    onClose();
    safeReturnFocus(returnFocusRef.current);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      handleModalTabKeyDown(event, overlayRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-ink/45" aria-hidden onClick={close} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-[71] flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-card bg-paper shadow-[0_24px_64px_rgba(31,35,40,0.18)] outline-none"
        data-testid="analyze-modal"
        data-outcome={confirming ? "confirm" : outcome}
      >
        <div className="flex flex-col gap-[22px] overflow-y-auto px-5 py-6 sm:px-9 sm:py-8 [&>*]:shrink-0">
          {!confirming ? (
            <div className="flex justify-center py-1">
              <div className="h-[148px] w-[148px] sm:h-[176px] sm:w-[176px]">
                <HoneycombActivity mode={livingMode} arrival={null} reducedMotion={reducedMotion} className="h-full w-full" />
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <h2 id={titleId} className="m-0 font-brand text-[28px] font-semibold leading-[1.15] text-ink">
              {copy.title}
            </h2>
            <p className="m-0 text-base leading-[1.55] text-ink-muted">{copy.sub}</p>
          </div>

          <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="analyze-live">
            {copy.title}
          </p>

          {confirming ? (
            <>
              {toRead.length > 0 ? (
                <ul aria-label="Documents to read" className="m-0 flex list-none flex-col overflow-hidden rounded-[14px] border border-line p-0">
                  {toRead.map((document) => (
                    <li key={document.sourceDocumentId} className="flex flex-col gap-0.5 border-b border-line px-4 py-3 last:border-b-0">
                      <span className="truncate text-[14.5px] font-medium text-ink" title={document.fileName}>
                        {document.fileName}
                      </span>
                      <span className="text-[13px] text-ink-muted">
                        {document.reason === "READ_ACTIVE" ? "Being read now." : "Will be read before the analysis."}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <GapList label="Missing content" gaps={missing} testId="analyze-missing" />
              <GapList label="Limitations" gaps={limitations} testId="analyze-limitations" />
            </>
          ) : awaiting ? (
            <>
              <GapList label="Missing content" gaps={missing} testId="analyze-missing" />
              <GapList label="Limitations" gaps={limitations} testId="analyze-limitations" />
            </>
          ) : (
            <ol className="m-0 grid list-none grid-cols-2 gap-x-2 gap-y-1 border-t border-line p-0 pt-1 sm:grid-cols-4" data-testid="analyze-steps">
              {steps.map((step) => (
                <li
                  key={step.key}
                  className="flex flex-col gap-1.5 pt-3"
                  aria-current={step.state === "active" ? "step" : undefined}
                  data-state={step.state}
                >
                  <span className={`h-[3px] rounded-[2px] ${STEP_BAR[step.state]}`} aria-hidden />
                  <span className={`text-[13px] leading-[1.3] ${step.state === "pending" ? "font-medium text-ink-subtle" : "font-semibold text-ink"}`}>
                    {step.label}
                    <span className="sr-only">
                      {step.state === "done" ? " (done)" : step.state === "active" ? " (in progress)" : step.state === "stopped" ? " (stopped)" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {acceptedRebuild ? (
            <div className="flex flex-col gap-1.5 rounded-[12px] bg-mist px-4 py-3.5" role="status" data-testid="rebuild-study-result">
              <span className="text-[14.5px] font-semibold text-ink">Revision {acceptedRebuild.revisionNumber}</span>
              <span className="text-[14.5px] leading-[1.55] text-ink-muted">
                {acceptedRebuild.sourceCount ?? 0} sources · {acceptedRebuild.documentFindingCount ?? 0} atomic document findings.
              </span>
            </div>
          ) : null}
          {reports.length > 0 ? (
            <ul aria-label="Your reports" className="m-0 flex list-none flex-col overflow-hidden rounded-[14px] border border-line p-0" data-testid="analyze-reports">
              {reports.map((row) => (
                <li key={row.audience} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0" data-state={row.state}>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[14.5px] font-medium text-ink">{row.label}</span>
                    <span className="text-[13px] text-ink-muted">{row.detail}</span>
                  </div>
                  <span className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium ${REPORT_BADGE[row.state]}`}>
                    {REPORT_BADGE_TEXT[row.state]}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {outcome === "succeeded" ? <GapList label="Limitations" gaps={limitations} testId="analyze-limitations" /> : null}

          {pollState === "auth_expired" && active ? (
            <p className="m-0 rounded-control bg-honey-wash px-3 py-2 text-sm text-honey-deep" role="status">
              Your session expired. Sign in again to see live updates. The analysis continues on our servers.
            </p>
          ) : null}
          {pollState === "reconnecting" && active ? (
            <p className="m-0 rounded-control bg-honey-wash px-3 py-2 text-sm text-honey-deep" role="status">
              We&apos;re having trouble reaching HiveForYou. We&apos;ll keep trying — the analysis continues on our servers.
            </p>
          ) : null}

          {outcome === "failed" && run ? (
            <div className="flex flex-col gap-1.5 rounded-[12px] bg-mist px-4 py-3.5" role="alert">
              <span className="text-[14.5px] font-semibold text-ink">What you can do</span>
              <span className="text-[14.5px] leading-[1.55] text-ink-muted">
                {run.retryable === false
                  ? "Contact support with the reference below."
                  : "Try again. Your documents and earlier results stay in your Hive."}
              </span>
              <span className="font-mono text-[11px] text-ink-subtle">Support reference: {run.correlationId}</span>
            </div>
          ) : null}
          {startError ? (
            <p className="m-0 text-sm text-coral-deep" role="alert">
              {startError.message}
              {startError.correlationId ? ` Support reference: ${startError.correlationId}` : ""}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2.5">
            {confirming ? (
              <>
                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={close}>
                  Cancel
                </button>
                <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={starting} onClick={onConfirm}>
                  {starting ? "Starting…" : action === "rebuild" ? "Rebuild what was read" : "Analyze what was read"}
                </button>
              </>
            ) : awaiting ? (
              <>
                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={close}>
                  Not now
                </button>
                <button
                  type="button"
                  className={PRIMARY_BUTTON_CLASS}
                  disabled={starting || !run?.coverageDigest}
                  onClick={onAcknowledge}
                  data-testid="analyze-acknowledge"
                >
                  {starting ? "Continuing…" : "Continue with what was read"}
                </button>
              </>
            ) : active ? (
              <>
                <span className="min-w-[200px] flex-1 self-center text-[13.5px] leading-[1.45] text-ink-subtle">
                  You can close this. HiveForYou keeps working.
                </span>
                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={close}>
                  Run in background
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={(outcome === "failed" && run?.retryable !== false) || anyReportReady ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
                  onClick={close}
                >
                  Close
                </button>
                {acceptedRebuild ? (
                  <Link
                    href={hiveStudyPath(hiveId)}
                    className={PRIMARY_BUTTON_CLASS}
                    data-testid="rebuild-open-study"
                  >
                    Open study revision {acceptedRebuild.revisionNumber}
                  </Link>
                ) : null}
                {anyReportReady ? (
                  <Link href={hiveReportsPath(hiveId)} className={PRIMARY_BUTTON_CLASS} data-testid="analyze-open-reports">
                    Open reports
                  </Link>
                ) : null}
                {outcome === "failed" && run?.retryable !== false ? (
                  <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={starting} onClick={onRetry}>
                    {starting ? "Starting…" : "Try again"}
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
