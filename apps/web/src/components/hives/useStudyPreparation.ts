"use client";

import {
  analyzeAvailability,
  type AnalyzeAvailability,
  documentsToRead,
  type GetStudyPreparationResponse,
  isActiveProcessingRunStatus,
  isActiveReportRunStatus,
  type ProcessingRun,
} from "@hiveforyou/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { HiveClientError } from "@/lib/hives-client";
import { acknowledgeStudyCoverage, fetchStudyPreparation, startStudyPreparation } from "@/lib/study-preparation-client";

import { DOCUMENT_READ_POLL_INTERVAL_MS, pollStateFromFailures } from "./document-read-progress";

export type AnalyzeStartError = { message: string; correlationId: string | null };
export type AnalyzeModalMode = "confirm" | "progress";

function isActive(run: ProcessingRun | null | undefined): boolean {
  return !!run && isActiveProcessingRunStatus(run.status);
}

function isAwaiting(run: ProcessingRun | null | undefined): boolean {
  return run?.status === "AWAITING_ACKNOWLEDGEMENT";
}

/**
 * Work still moving for this Hive: the analysis run, or a Writer run of the accepted Study. A run
 * waiting for the owner's coverage review is not moving, so it is not polled.
 */
function isWorking(state: Pick<GetStudyPreparationResponse, "processingRun" | "reportRuns"> | null): boolean {
  if (!state) return false;
  if (isAwaiting(state.processingRun)) return false;
  if (isActive(state.processingRun)) return true;
  return state.processingRun?.status === "SUCCEEDED" && state.reportRuns.some((run) => isActiveReportRunStatus(run.status));
}

function minimizedKey(hiveId: string): string {
  return `hfy-analysis-minimized-${hiveId}`;
}

function readMinimized(hiveId: string): string | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(minimizedKey(hiveId));
  } catch {
    return null;
  }
}

function writeMinimized(hiveId: string, runId: string | null): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    if (runId) sessionStorage.setItem(minimizedKey(hiveId), runId);
    else sessionStorage.removeItem(minimizedKey(hiveId));
  } catch {
    // private mode or quota; the modal simply reopens
  }
}

/**
 * Durable Analyze progress for one Hive: state always comes from `GET …/study-preparation`, so
 * closing the modal, refreshing or reconnecting never loses progress. Polls while the analysis or
 * either Writer run is still moving, so the modal follows every stage through to both reports.
 */
export function useStudyPreparation(hiveId: string) {
  const [state, setState] = useState<GetStudyPreparationResponse | null>(null);
  const [modalMode, setModalMode] = useState<AnalyzeModalMode | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<AnalyzeStartError | null>(null);
  const [pollFailures, setPollFailures] = useState(0);
  const [authExpired, setAuthExpired] = useState(false);

  const runRef = useRef<ProcessingRun | null>(null);
  const stateRef = useRef<GetStudyPreparationResponse | null>(null);
  const startingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestSeqRef = useRef(0);
  const settledSeqRef = useRef(0);
  const failuresRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const apply = useCallback(
    (next: GetStudyPreparationResponse) => {
      const wasWorking = isWorking(stateRef.current);
      runRef.current = next.processingRun;
      stateRef.current = next;
      setState(next);
      if (wasWorking && !isWorking(next)) {
        stopPolling();
        writeMinimized(hiveId, null);
      }
    },
    [hiveId, stopPolling],
  );

  const refresh = useCallback(async () => {
    requestSeqRef.current += 1;
    const seq = requestSeqRef.current;
    try {
      const result = await fetchStudyPreparation(hiveId);
      if (seq <= settledSeqRef.current) return;
      settledSeqRef.current = seq;
      failuresRef.current = 0;
      setPollFailures(0);
      setAuthExpired(false);
      apply(result);
    } catch (error) {
      if (seq <= settledSeqRef.current) return;
      settledSeqRef.current = seq;
      if (error instanceof HiveClientError && error.errorCode === "UNAUTHENTICATED") setAuthExpired(true);
      failuresRef.current += 1;
      setPollFailures(failuresRef.current);
    }
  }, [apply, hiveId]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => void refresh(), DOCUMENT_READ_POLL_INTERVAL_MS);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void fetchStudyPreparation(hiveId)
      .then((result) => {
        if (cancelled || settledSeqRef.current > 0) return;
        runRef.current = result.processingRun;
        stateRef.current = result;
        setState(result);
        if (isWorking(result)) startPolling();
        if (isActive(result.processingRun) && readMinimized(hiveId) !== result.processingRun?.id) setModalMode("progress");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [hiveId, startPolling, stopPolling]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && isWorking(stateRef.current)) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const start = useCallback(
    async (consent?: { coverageAcknowledgementDigest: string }) => {
      if (startingRef.current) return;
      startingRef.current = true;
      setStarting(true);
      setStartError(null);
      try {
        const result = await startStudyPreparation(hiveId, {
          clientRequestId: crypto.randomUUID(),
          ...(consent ? { coverageAcknowledgementDigest: consent.coverageAcknowledgementDigest } : {}),
        });
        runRef.current = result.processingRun;
        setState((current) => {
          const next = current ? { ...current, processingRun: result.processingRun, reportRuns: [] } : current;
          stateRef.current = next;
          return next;
        });
        writeMinimized(hiveId, null);
        setModalMode("progress");
        if (isActive(result.processingRun)) startPolling();
        void refresh();
      } catch (error) {
        setStartError(
          error instanceof HiveClientError
            ? { message: error.message, correlationId: error.correlationId || null }
            : { message: "Could not start the analysis. Try again.", correlationId: null },
        );
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [hiveId, refresh, startPolling],
  );

  const availability: AnalyzeAvailability | null = state
    ? analyzeAvailability(state.eligibility, state.processingRun)
    : null;

  /**
   * Analyze click: starts directly unless material gaps already known now were never acknowledged
   * in this Hive; then the owner reviews them first. Gaps that reading discovers later pause the
   * run (AWAITING_ACKNOWLEDGEMENT) for `acknowledge`.
   */
  const analyze = useCallback(() => {
    if (!availability?.canAnalyze) {
      if (availability?.reason === "AWAITING_ACKNOWLEDGEMENT") {
        setStartError(null);
        setModalMode("progress");
      }
      return;
    }
    if (availability.requiresCoverageAcknowledgement) {
      setStartError(null);
      setModalMode("confirm");
      return;
    }
    void start();
  }, [availability, start]);

  const confirmCoverage = useCallback(() => {
    if (state) void start({ coverageAcknowledgementDigest: state.eligibility.coverageDigest });
  }, [start, state]);

  /** The owner continues a paused run with what was read; no document is read again. */
  const acknowledge = useCallback(async () => {
    const run = runRef.current;
    if (!isAwaiting(run) || !run?.coverageDigest || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setStartError(null);
    try {
      const result = await acknowledgeStudyCoverage(hiveId, {
        processingRunId: run.id,
        coverageDigest: run.coverageDigest,
      });
      runRef.current = result.processingRun;
      setState((current) => {
        const next = current ? { ...current, processingRun: result.processingRun } : current;
        stateRef.current = next;
        return next;
      });
      if (isActive(result.processingRun) && !isAwaiting(result.processingRun)) startPolling();
      void refresh();
    } catch (error) {
      setStartError(
        error instanceof HiveClientError
          ? { message: error.message, correlationId: error.correlationId || null }
          : { message: "Could not continue the analysis. Try again.", correlationId: null },
      );
      void refresh();
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [hiveId, refresh, startPolling]);

  const closeModal = useCallback(() => {
    if (isActive(runRef.current)) writeMinimized(hiveId, runRef.current?.id ?? null);
    setModalMode(null);
  }, [hiveId]);

  const openModal = useCallback(() => {
    writeMinimized(hiveId, null);
    setModalMode("progress");
  }, [hiveId]);

  return {
    state,
    run: state?.processingRun ?? null,
    reportRuns: state?.reportRuns ?? [],
    toRead: state ? documentsToRead(state.eligibility) : [],
    availability,
    active: isActive(state?.processingRun),
    awaiting: isAwaiting(state?.processingRun),
    modalMode,
    starting,
    startError,
    pollState: pollStateFromFailures(pollFailures, authExpired),
    returnFocusRef,
    analyze,
    confirmCoverage,
    acknowledge,
    retry: analyze,
    refresh,
    openModal,
    closeModal,
  };
}
