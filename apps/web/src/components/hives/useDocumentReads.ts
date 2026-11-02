"use client";

import type { DocumentRead } from "@hiveforyou/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchDocumentReads, startDocumentReads } from "@/lib/document-reads-client";
import { HiveClientError } from "@/lib/hives-client";

import {
  DOCUMENT_READ_POLL_INTERVAL_MS,
  hasActiveReads,
  pollStateFromFailures,
  readArrivalMessage,
  readCounter,
} from "./document-read-progress";

export type ReadStartError = { message: string; correlationId: string | null };

function minimizedKey(hiveId: string): string {
  return `hfy-reads-minimized-${hiveId}`;
}

function activeSignature(reads: readonly DocumentRead[]): string {
  return reads
    .filter((read) => hasActiveReads([read]))
    .map((read) => read.id)
    .sort()
    .join(",");
}

function readMinimized(hiveId: string): string | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(minimizedKey(hiveId));
  } catch {
    return null;
  }
}

function writeMinimized(hiveId: string, signature: string | null): void {
  try {
    if (typeof sessionStorage === "undefined") {
      return;
    }
    if (signature) {
      sessionStorage.setItem(minimizedKey(hiveId), signature);
    } else {
      sessionStorage.removeItem(minimizedKey(hiveId));
    }
  } catch {
    // private mode or quota; the modal simply reopens
  }
}

/**
 * Durable read progress for one Hive: state always comes from `GET …/document-reads`, so closing the
 * modal, refreshing or losing the connection never loses progress. Polls only while a read is active.
 */
export function useDocumentReads(hiveId: string, onSettled: () => void) {
  const [reads, setReads] = useState<DocumentRead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<ReadStartError | null>(null);
  const [pollFailures, setPollFailures] = useState(0);
  const [authExpired, setAuthExpired] = useState(false);
  const [arrival, setArrival] = useState<{ seq: number; message: string; finished: number } | null>(null);

  const readsRef = useRef<DocumentRead[]>([]);
  const startingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestSeqRef = useRef(0);
  const settledSeqRef = useRef(0);
  const failuresRef = useRef(0);
  const arrivalSeqRef = useRef(0);
  const onSettledRef = useRef(onSettled);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  onSettledRef.current = onSettled;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const applyReads = useCallback(
    (next: DocumentRead[]) => {
      const previous = readsRef.current;
      readsRef.current = next;
      setReads(next);
      const message = readArrivalMessage(readCounter(previous), readCounter(next));
      if (message && hasActiveReads(previous)) {
        arrivalSeqRef.current += 1;
        const counter = readCounter(next);
        setArrival({ seq: arrivalSeqRef.current, message, finished: counter.read + counter.unreadable });
      }
      if (hasActiveReads(previous) && !hasActiveReads(next)) {
        stopPolling();
        writeMinimized(hiveId, null);
        onSettledRef.current();
      }
    },
    [hiveId, stopPolling],
  );

  const refresh = useCallback(async () => {
    requestSeqRef.current += 1;
    const seq = requestSeqRef.current;
    try {
      const result = await fetchDocumentReads(hiveId);
      if (seq <= settledSeqRef.current) {
        return;
      }
      settledSeqRef.current = seq;
      failuresRef.current = 0;
      setPollFailures(0);
      setAuthExpired(false);
      applyReads(result.documentReads);
    } catch (error) {
      if (seq <= settledSeqRef.current) {
        return;
      }
      settledSeqRef.current = seq;
      if (error instanceof HiveClientError && error.errorCode === "UNAUTHENTICATED") {
        setAuthExpired(true);
      }
      failuresRef.current += 1;
      setPollFailures(failuresRef.current);
    }
  }, [applyReads, hiveId]);

  const startPolling = useCallback(() => {
    if (pollRef.current) {
      return;
    }
    pollRef.current = setInterval(() => {
      void refresh();
    }, DOCUMENT_READ_POLL_INTERVAL_MS);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void fetchDocumentReads(hiveId)
      .then((result) => {
        if (cancelled || settledSeqRef.current > 0) {
          return;
        }
        readsRef.current = result.documentReads;
        setReads(result.documentReads);
        if (hasActiveReads(result.documentReads)) {
          startPolling();
          if (readMinimized(hiveId) !== activeSignature(result.documentReads)) {
            setModalOpen(true);
          }
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [hiveId, startPolling, stopPolling]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && hasActiveReads(readsRef.current)) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const start = useCallback(
    async (sourceDocumentIds?: string[]) => {
      if (startingRef.current) {
        return;
      }
      startingRef.current = true;
      setStarting(true);
      setStartError(null);
      try {
        const result = await startDocumentReads(hiveId, {
          clientRequestId: crypto.randomUUID(),
          ...(sourceDocumentIds && sourceDocumentIds.length > 0 ? { sourceDocumentIds } : {}),
        });
        requestSeqRef.current += 1;
        settledSeqRef.current = requestSeqRef.current;
        readsRef.current = result.documentReads;
        setReads(result.documentReads);
        writeMinimized(hiveId, null);
        setModalOpen(true);
        if (hasActiveReads(result.documentReads)) {
          startPolling();
        }
      } catch (error) {
        setStartError(
          error instanceof HiveClientError
            ? { message: error.message, correlationId: error.correlationId || null }
            : { message: "Could not start reading your documents. Try again.", correlationId: null },
        );
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [hiveId, startPolling],
  );

  const closeModal = useCallback(() => {
    if (hasActiveReads(readsRef.current)) {
      writeMinimized(hiveId, activeSignature(readsRef.current));
    }
    setModalOpen(false);
  }, [hiveId]);

  const openModal = useCallback(() => {
    writeMinimized(hiveId, null);
    setModalOpen(true);
  }, [hiveId]);

  return {
    reads,
    loaded,
    active: hasActiveReads(reads),
    modalOpen,
    starting,
    startError,
    pollState: pollStateFromFailures(pollFailures, authExpired),
    arrival,
    returnFocusRef,
    start,
    openModal,
    closeModal,
  };
}
