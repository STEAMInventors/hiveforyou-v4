"use client";

import {
  describeCoverageGaps,
  type CoverageGap,
  type ProcessingRun,
  type StudyPreparationEligibility,
} from "@hiveforyou/contracts";
import { useEffect, useId, useRef } from "react";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { handleModalTabKeyDown, safeReturnFocus } from "@/lib/a11y/modal-focus";
import { usePrefersReducedMotion } from "@/lib/a11y/reduced-motion";

import type { ReadPollState } from "./document-read-progress";
import { HoneycombActivity, type LivingHiveMode } from "./HoneycombActivity";
import { preparationCopy, preparationOutcome, preparationSteps } from "./study-preparation-progress";
import type { AnalyzeModalMode, AnalyzeStartError } from "./useStudyPreparation";

type AnalyzeModalProps = {
  mode: AnalyzeModalMode | null;
  run: ProcessingRun | null;
  eligibility: StudyPreparationEligibility | null;
  pollState: ReadPollState;
  starting: boolean;
  startError: AnalyzeStartError | null;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onConfirm: () => void;
  onRetry: () => void;
};

const STEP_BAR: Record<string, string> = {
  done: "bg-leaf",
  active: "bg-cell-blue",
  stopped: "bg-line-strong",
  pending: "bg-line",
};

const EXCLUSION_TEXT: Record<string, string> = {
  NOT_READ: "not read yet",
  READ_FAILED: "reading didn't finish",
  UNREADABLE: "no readable text",
  READ_ACTIVE: "still being read",
};

function gapText(gap: CoverageGap): string {
  switch (gap.kind) {
    case "EXCLUDED":
      return `Not included — ${EXCLUSION_TEXT[gap.reason ?? "NOT_READ"] ?? "not read"}.`;
    case "PARTIAL_READ":
      return "Only partly readable.";
    case "MISSING_PAGES":
      return `Pages not saved: ${gap.pageNumbers?.join(", ")}.`;
    case "EMPTY_PAGES":
      return `Pages with no text: ${gap.pageNumbers?.join(", ")}.`;
  }
}

export function AnalyzeModal(props: AnalyzeModalProps) {
  if (!props.mode) return null;
  if (props.mode === "progress" && !props.run && !props.startError) return null;
  return <AnalyzeDialog {...props} />;
}

function AnalyzeDialog({
  mode,
  run,
  eligibility,
  pollState,
  starting,
  startError,
  returnFocusRef,
  onClose,
  onConfirm,
  onRetry,
}: AnalyzeModalProps) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const confirming = mode === "confirm";
  const outcome = confirming ? "idle" : preparationOutcome(run);
  const active = outcome === "active";
  const copy = confirming
    ? {
        title: "Some content is missing",
        sub: "The analysis will use only what was read. Review what's missing before you continue.",
      }
    : preparationCopy(run);
  const steps = preparationSteps(confirming ? null : run);
  const gaps = confirming && eligibility ? describeCoverageGaps(eligibility) : [];
  const livingMode: LivingHiveMode =
    outcome === "succeeded"
      ? "success"
      : outcome === "failed"
        ? "failed"
        : outcome === "needs_clarification"
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
            <ul aria-label="Missing content" className="m-0 flex list-none flex-col overflow-hidden rounded-[14px] border border-line p-0">
              {gaps.map((gap, index) => (
                <li key={`${gap.sourceDocumentId}-${gap.kind}-${index}`} className="flex flex-col gap-0.5 border-b border-line px-4 py-3 last:border-b-0">
                  <span className="truncate text-[14.5px] font-medium text-ink" title={gap.fileName}>
                    {gap.fileName}
                  </span>
                  <span className="text-[13px] text-coral-deep">{gapText(gap)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ol className="m-0 grid list-none grid-cols-5 gap-2 border-t border-line p-0 pt-1" data-testid="analyze-steps">
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
                  {starting ? "Starting…" : "Analyze what was read"}
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
                  className={outcome === "failed" && run?.retryable !== false ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
                  onClick={close}
                >
                  Close
                </button>
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
