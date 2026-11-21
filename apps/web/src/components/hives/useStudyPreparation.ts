"use client";

import {
  analyzeAvailability,
  type AnalyzeAvailability,
  rebuildAvailability,
  type RebuildAvailability,
  documentsToRead,
  type GetStudyPreparationResponse,
  isActiveProcessingRunStatus,
  isActiveReportRunStatus,
  type ProcessingRun,
} from "@hiveforyou/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { HiveClientError } from "@/lib/hives-client";
import { acknowledgeStudyCoverage, fetchStudyPreparation, rebuildStudy, startStudyPreparation } from "@/lib/study-preparation-client";

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

export type UseStudyPreparationOptions = {
  readonly onReportsReady?: () => void;
  /** Server-rendered preparation so Study/Documents actions are available before the client refetch. */
  readonly initialPreparation?: GetStudyPreparationResponse;
};

/**
 * Durable Analyze progress for one Hive: state always comes from `GET …/study-preparation`, so
 * closing the modal, refreshing or reconnecting never loses progress. Polls while the analysis or
 * either Writer run is still moving, so the modal follows every stage through to both reports.
 */
export function useStudyPreparation(hiveId: string, options?: UseStudyPreparationOptions) {
  const onReportsReady = options?.onReportsReady;
  const onReportsReadyRef = useRef(onReportsReady);
  onReportsReadyRef.current = onReportsReady;
  const initialPreparation = options?.initialPreparation ?? null;
  const [state, setState] = useState<GetStudyPreparationResponse | null>(initialPreparation);
  const [modalMode, setModalMode] = useState<AnalyzeModalMode | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<AnalyzeStartError | null>(null);
  const [pollFailures, setPollFailures] = useState(0);
  const [authExpired, setAuthExpired] = useState(false);
  const [action, setAction] = useState<"analyze" | "rebuild">("analyze");

  const runRef = useRef<ProcessingRun | null>(initialPreparation?.processingRun ?? null);
  const stateRef = useRef<GetStudyPreparationResponse | null>(initialPreparation);
  const startingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestSeqRef = useRef(0);
  const settledSeqRef = useRef(0);
  const failuresRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const actionRef = useRef<"analyze" | "rebuild">("analyze");
  const withoutDomainPackRef = useRef(false);

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
      const action = actionRef.current;
      startingRef.current = true;
      setStarting(true);
      setStartError(null);
      try {
        const payload = {
          clientRequestId: crypto.randomUUID(),
          ...(consent ? { coverageAcknowledgementDigest: consent.coverageAcknowledgementDigest } : {}),
          ...(action === "rebuild" && withoutDomainPackRef.current ? { withoutDomainPack: true } : {}),
        };
        const result = action === "rebuild" ? await rebuildStudy(hiveId, payload) : await startStudyPreparation(hiveId, payload);
        runRef.current = result.processingRun;
        const nextReportRuns = result.reportRuns ?? [];
        setState((current) => {
          const next = current
            ? {
                ...current,
                processingRun: result.processingRun,
                ...(result.studyRevision !== undefined ? { studyRevision: result.studyRevision } : {}),
                reportRuns: nextReportRuns,
              }
            : current;
          stateRef.current = next;
          return next;
        });
        writeMinimized(hiveId, null);
        const bothReportsSucceeded =
          result.reportsReady === true ||
          (result.processingRun.status === "SUCCEEDED" &&
            (["CUSTOMER", "PRO"] as const).every((audience) =>
              nextReportRuns.some((run) => run.audience === audience && run.status === "SUCCEEDED" && run.reportId !== null),
            ));
        if (action === "analyze" && bothReportsSucceeded) {
          setModalMode(null);
          onReportsReadyRef.current?.();
          void refresh();
          return;
        }
        setModalMode("progress");
        if (isWorking({ processingRun: result.processingRun, reportRuns: nextReportRuns })) startPolling();
        void refresh();
      } catch (error) {
        setStartError(
          error instanceof HiveClientError
            ? { message: error.message, correlationId: error.correlationId || null }
            : {
                message: action === "rebuild" ? "Could not rebuild the study. Try again." : "Could not start the analysis. Try again.",
                correlationId: null,
              },
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
  const rebuildReady: RebuildAvailability | null = state
    ? rebuildAvailability(state.eligibility, state.processingRun, state.studyRevision)
    : null;

  /**
   * Analyze click: starts directly unless material gaps already known now were never acknowledged
   * in this Hive; then the owner reviews them first. Gaps that reading discovers later pause the
   * run (AWAITING_ACKNOWLEDGEMENT) for `acknowledge`.
   */
  const analyze = useCallback(() => {
    actionRef.current = "analyze";
    setAction("analyze");
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

  const rebuild = useCallback(() => {
    if (!rebuildReady?.canRebuild) {
      if (rebuildReady?.reason === "AWAITING_ACKNOWLEDGEMENT") {
        setStartError(null);
        setModalMode("progress");
      }
      return;
    }
    actionRef.current = "rebuild";
    withoutDomainPackRef.current = false;
    setAction("rebuild");
    if (rebuildReady.requiresCoverageAcknowledgement) {
      setStartError(null);
      setModalMode("confirm");
      return;
    }
    void start();
  }, [rebuildReady, start]);

  const rebuildWithoutChecklist = useCallback(() => {
    if (!rebuildReady?.canRebuild) {
      if (rebuildReady?.reason === "AWAITING_ACKNOWLEDGEMENT") {
        setStartError(null);
        setModalMode("progress");
      }
      return;
    }
    actionRef.current = "rebuild";
    withoutDomainPackRef.current = true;
    setAction("rebuild");
    if (rebuildReady.requiresCoverageAcknowledgement) {
      setStartError(null);
      setModalMode("confirm");
      return;
    }
    void start();
  }, [rebuildReady, start]);

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
    rebuildAvailability: rebuildReady,
    action,
    active: isActive(state?.processingRun),
    awaiting: isAwaiting(state?.processingRun),
    modalMode,
    starting,
    startError,
    pollState: pollStateFromFailures(pollFailures, authExpired),
    returnFocusRef,
    analyze,
    rebuild,
    rebuildWithoutChecklist,
    confirmCoverage,
    acknowledge,
    retry: () => {
      const next = runRef.current?.preparationMode === "REBUILD" ? "rebuild" : "analyze";
      actionRef.current = next;
      setAction(next);
      void start();
    },
    refresh,
    openModal,
    closeModal,
  };
}
