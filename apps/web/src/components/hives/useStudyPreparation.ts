"use client";

import {
  analyzeAvailability,
  type AnalyzeAvailability,
  type GetStudyPreparationResponse,
  isActiveProcessingRunStatus,
  type ProcessingRun,
} from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { hiveStudyPath } from "@/lib/hive-routes";
import { HiveClientError } from "@/lib/hives-client";
import { fetchStudyPreparation, startStudyPreparation } from "@/lib/study-preparation-client";

import { DOCUMENT_READ_POLL_INTERVAL_MS, pollStateFromFailures } from "./document-read-progress";

export type AnalyzeStartError = { message: string; correlationId: string | null };
export type AnalyzeModalMode = "confirm" | "progress";

function isActive(run: ProcessingRun | null | undefined): boolean {
  return !!run && isActiveProcessingRunStatus(run.status);
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
 * closing the modal, refreshing or reconnecting never loses progress. Polls only while a run is
 * active, and opens the Study tab when the run it watched succeeds.
 */
export function useStudyPreparation(hiveId: string) {
  const router = useRouter();
  const [state, setState] = useState<GetStudyPreparationResponse | null>(null);
  const [modalMode, setModalMode] = useState<AnalyzeModalMode | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<AnalyzeStartError | null>(null);
  const [pollFailures, setPollFailures] = useState(0);
  const [authExpired, setAuthExpired] = useState(false);

  const runRef = useRef<ProcessingRun | null>(null);
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
      const previous = runRef.current;
      runRef.current = next.processingRun;
      setState(next);
      if (isActive(previous) && !isActive(next.processingRun)) {
        stopPolling();
        writeMinimized(hiveId, null);
        if (next.processingRun?.status === "SUCCEEDED" && next.processingRun.id === previous?.id) {
          router.push(hiveStudyPath(hiveId));
        }
      }
    },
    [hiveId, router, stopPolling],
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
        setState(result);
        if (isActive(result.processingRun)) {
          startPolling();
          if (readMinimized(hiveId) !== result.processingRun?.id) setModalMode("progress");
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [hiveId, startPolling, stopPolling]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && isActive(runRef.current)) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const start = useCallback(
    async (coverageAcknowledgementDigest?: string) => {
      if (startingRef.current) return;
      startingRef.current = true;
      setStarting(true);
      setStartError(null);
      try {
        const result = await startStudyPreparation(hiveId, {
          clientRequestId: crypto.randomUUID(),
          ...(coverageAcknowledgementDigest ? { coverageAcknowledgementDigest } : {}),
        });
        runRef.current = result.processingRun;
        setState((current) => (current ? { ...current, processingRun: result.processingRun } : current));
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

  /** Analyze click: review coverage gaps first when coverage is partial, otherwise start. */
  const analyze = useCallback(() => {
    if (!availability?.canAnalyze) return;
    if (availability.requiresCoverageAcknowledgement) {
      setStartError(null);
      setModalMode("confirm");
      return;
    }
    void start();
  }, [availability, start]);

  const confirmCoverage = useCallback(() => {
    if (state) void start(state.eligibility.coverageDigest);
  }, [start, state]);

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
    availability,
    active: isActive(state?.processingRun),
    modalMode,
    starting,
    startError,
    pollState: pollStateFromFailures(pollFailures, authExpired),
    returnFocusRef,
    analyze,
    confirmCoverage,
    retry: analyze,
    refresh,
    openModal,
    closeModal,
  };
}
