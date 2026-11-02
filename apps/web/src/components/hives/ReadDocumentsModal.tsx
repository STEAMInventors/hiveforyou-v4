"use client";

import type { DocumentRead } from "@hiveforyou/contracts";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";

import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { handleModalTabKeyDown, safeReturnFocus } from "@/lib/a11y/modal-focus";
import { usePrefersReducedMotion } from "@/lib/a11y/reduced-motion";

import {
  documentReadDetail,
  isReadProgressStale,
  readCounter,
  readModalCopy,
  readModalOutcome,
  type ReadPollState,
  readStatusPresentation,
  readSteps,
} from "./document-read-progress";
import { HONEYCOMB_COLORS, HoneycombActivity, type LivingHiveMode } from "./HoneycombActivity";
import type { ReadStartError } from "./useDocumentReads";

type ReadDocumentsModalProps = {
  open: boolean;
  reads: readonly DocumentRead[];
  fileNames: ReadonlyMap<string, string>;
  pollState: ReadPollState;
  arrival: { seq: number; message: string; finished: number } | null;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Re-reads documents whose last attempt failed; omitted when nothing can be retried. */
  onRetry: (() => void) | null;
  retryBusy: boolean;
  retryError: ReadStartError | null;
};

const STEP_BAR: Record<string, string> = {
  done: "bg-leaf",
  active: "bg-cell-blue",
  stopped: "bg-line-strong",
  pending: "bg-line",
};

export function ReadDocumentsModal(props: ReadDocumentsModalProps) {
  if (!props.open || props.reads.length === 0) {
    return null;
  }
  return <ReadDocumentsDialog {...props} />;
}

function ReadDocumentsDialog({
  reads,
  fileNames,
  pollState,
  arrival,
  returnFocusRef,
  onClose,
  onRetry,
  retryBusy,
  retryError,
}: ReadDocumentsModalProps) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const seenArrivalRef = useRef(arrival?.seq ?? 0);
  const [pulse, setPulse] = useState<{ id: number; color: string } | null>(null);

  const outcome = readModalOutcome(reads);
  const active = outcome === "active";
  const counter = readCounter(reads);
  const copy = readModalCopy(reads);
  const steps = readSteps(reads);
  const stale = active && pollState === "ok" && isReadProgressStale(reads, nowMs);
  const mode: LivingHiveMode = active ? "processing" : outcome === "failed" ? "failed" : "success";

  const close = () => {
    onClose();
    safeReturnFocus(returnFocusRef.current);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    dialogRef.current?.focus();
    const tick = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(tick);
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

  useEffect(() => {
    if (!arrival || arrival.seq <= seenArrivalRef.current) {
      return;
    }
    seenArrivalRef.current = arrival.seq;
    setPulse({ id: arrival.seq, color: HONEYCOMB_COLORS[(((arrival.finished - 1) % 4) + 4) % 4]! });
    const timer = window.setTimeout(() => setPulse(null), 900);
    return () => window.clearTimeout(timer);
  }, [arrival]);

  const live = active ? (arrival?.message ?? "") : copy.title;

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
        data-testid="read-documents-modal"
        data-outcome={outcome}
      >
        <div className="flex flex-col gap-[22px] overflow-y-auto px-5 py-6 sm:px-9 sm:py-8 [&>*]:shrink-0">
          <div className="flex justify-center py-1">
            <div className="h-[148px] w-[148px] sm:h-[176px] sm:w-[176px]">
              <HoneycombActivity
                mode={mode}
                arrival={arrival ? { seq: arrival.seq, kind: "single", finished: arrival.finished } : null}
                reducedMotion={reducedMotion}
                className="h-full w-full"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h2 id={titleId} className="m-0 font-brand text-[28px] font-semibold leading-[1.15] text-ink">
              {copy.title}
            </h2>
            <p className="m-0 text-base leading-[1.55] text-ink-muted">{copy.sub}</p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span
                key={pulse ? `count-${pulse.id}` : "count"}
                className={`hfy-lh-count font-brand text-[40px] font-semibold leading-none text-ink${
                  pulse && !reducedMotion ? " hfy-lh-count--pulse" : ""
                }`}
                style={pulse ? ({ "--lh-pulse": pulse.color } as CSSProperties) : undefined}
                data-testid="read-count"
              >
                {counter.read}
              </span>
              <span className="text-lg font-medium text-ink-muted">
                of {counter.total} document{counter.total === 1 ? "" : "s"} read
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={counter.total}
              aria-valuenow={counter.read}
              aria-label="Documents read"
              className="grid gap-[5px]"
              style={{ gridTemplateColumns: `repeat(${counter.total}, minmax(0, 1fr))` }}
            >
              {reads.map((read) => {
                const done = read.status === "SUCCEEDED" || read.status === "PARTIAL";
                const finished = done || read.status === "UNREADABLE" || read.status === "FAILED";
                return (
                  <span key={read.id} className="relative h-2 overflow-hidden rounded-[4px] bg-mist">
                    <span
                      className={`absolute inset-y-0 left-0 rounded-[4px] ${done ? "bg-leaf" : "bg-line-strong"}`}
                      style={{
                        width: finished ? "100%" : "0%",
                        transition: reducedMotion ? "none" : "width .5s cubic-bezier(.2,.7,.2,1)",
                      }}
                    />
                  </span>
                );
              })}
            </div>
          </div>

          <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="read-live">
            {live}
          </p>

          {pollState === "auth_expired" ? (
            <p className="m-0 rounded-control bg-honey-wash px-3 py-2 text-sm text-honey-deep" role="status">
              Your session expired. Sign in again to see live updates. Reading continues on our servers.
            </p>
          ) : null}
          {pollState === "reconnecting" ? (
            <p className="m-0 rounded-control bg-honey-wash px-3 py-2 text-sm text-honey-deep" role="status">
              We&apos;re having trouble reaching HiveForYou. We&apos;ll keep trying — reading continues on our servers.
            </p>
          ) : null}
          {stale ? (
            <p className="m-0 rounded-control bg-cell-blue-tint px-3 py-2 text-sm text-ink" role="status">
              Reading can take several minutes per document. We haven&apos;t recorded a new update in a few
              minutes — we&apos;re still checking.
            </p>
          ) : null}

          <ol className="m-0 grid list-none grid-cols-5 gap-2 border-t border-line p-0 pt-1" data-testid="read-steps">
            {steps.map((step) => (
              <li
                key={step.label}
                className="flex flex-col gap-1.5 pt-3"
                aria-current={step.state === "active" ? "step" : undefined}
                data-state={step.state}
              >
                <span className={`h-[3px] rounded-[2px] ${STEP_BAR[step.state]}`} aria-hidden />
                <span
                  className={`text-[13px] leading-[1.3] ${
                    step.state === "pending" ? "font-medium text-ink-subtle" : "font-semibold text-ink"
                  }`}
                >
                  {step.label}
                  <span className="sr-only">
                    {step.state === "done"
                      ? " (done)"
                      : step.state === "active"
                        ? " (in progress)"
                        : step.state === "stopped"
                          ? " (stopped)"
                          : ""}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <ul
            aria-label="Documents"
            className="m-0 flex list-none flex-col overflow-hidden rounded-[14px] border border-line p-0"
          >
            {reads.map((read) => {
              const presentation = readStatusPresentation(read.status);
              const failed = read.status === "FAILED" || read.status === "UNREADABLE";
              return (
                <li
                  key={read.id}
                  className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0"
                  data-testid="read-document-row"
                  data-status={read.status}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink"
                      title={fileNames.get(read.sourceDocumentId)}
                    >
                      {fileNames.get(read.sourceDocumentId) ?? "Document"}
                    </span>
                    <span
                      className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium ${presentation.className}`}
                    >
                      {presentation.label}
                    </span>
                  </div>
                  <p className="m-0 text-[13px] text-ink-muted" role={failed ? "alert" : undefined}>
                    {documentReadDetail(read)}
                  </p>
                  {failed ? (
                    <p className="m-0 font-mono text-[11px] text-ink-subtle">
                      Support reference: {read.correlationId}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {outcome === "failed" ? (
            <div className="flex flex-col gap-1.5 rounded-[12px] bg-mist px-4 py-3.5">
              <span className="text-[14.5px] font-semibold text-ink">What you can do</span>
              <span className="text-[14.5px] leading-[1.55] text-ink-muted">
                {onRetry
                  ? "Try again. Pages that were already saved are kept, and your documents stay in your Hive."
                  : "Contact support with the reference shown for the document that didn't finish."}
              </span>
            </div>
          ) : null}
          {retryError ? (
            <p className="m-0 text-sm text-coral-deep" role="alert">
              {retryError.message}
              {retryError.correlationId ? ` Support reference: ${retryError.correlationId}` : ""}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2.5">
            {active ? (
              <>
                <span className="min-w-[200px] flex-1 self-center text-[13.5px] leading-[1.45] text-ink-subtle">
                  You can close this. HiveForYou keeps reading.
                </span>
                <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={close}>
                  Run in background
                </button>
              </>
            ) : (
              <>
                <button type="button" className={onRetry ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS} onClick={close}>
                  Close
                </button>
                {onRetry ? (
                  <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={retryBusy} onClick={onRetry}>
                    {retryBusy ? "Starting…" : "Try again"}
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
