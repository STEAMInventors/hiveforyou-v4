"use client";

import type { PublicErrorBody } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { isDevGalleryPath } from "@/lib/dev-gallery-path";
import { CORRELATION_HEADER_NAME } from "@/lib/hives-client";

export type WorkspaceActionFailure = {
  message: string;
  reference: string | null;
  /** Network failures can be retried with the same idempotency key. */
  retryable: boolean;
  errorCode?: string;
};

export type WorkspaceActionRunOptions = {
  url: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Reuse the same key for Try again; omitted keys are always fresh. */
  idempotencyKey?: string;
  failureMessage?: string;
  refreshOnSuccess?: boolean;
  /** Called with the same failure that becomes `inlineError`, for callers that track several attempts. */
  onFailure?: (failure: WorkspaceActionFailure) => void;
};

type StoredAttempt = {
  key: string;
  url: string;
  body: string | undefined;
};

function isPublicErrorBody(value: unknown): value is PublicErrorBody {
  if (!value || typeof value !== "object") return false;
  const error = (value as { error?: unknown }).error;
  return (
    Boolean(error) &&
    typeof error === "object" &&
    typeof (error as { errorCode?: unknown }).errorCode === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function referenceSnippet(correlationId: string): string {
  return correlationId.slice(0, 8);
}

function bodyFingerprint(body: unknown): string | undefined {
  return body === undefined ? undefined : JSON.stringify(body);
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}

const NETWORK_MESSAGE = "Couldn't reach HiveForYou. Check your connection and try again.";

export function useWorkspaceAction(signInNextPath?: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [inlineError, setInlineError] = useState<WorkspaceActionFailure | null>(null);
  const lastAttemptRef = useRef<StoredAttempt | null>(null);
  const inFlightRef = useRef(false);

  const signInHref = useCallback(() => {
    const next =
      signInNextPath ??
      (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/hives");
    return `/sign-in?next=${encodeURIComponent(next)}`;
  }, [signInNextPath]);

  const run = useCallback(
    async (options: WorkspaceActionRunOptions): Promise<unknown | null> => {
      if (inFlightRef.current) return null;
      const fingerprint = bodyFingerprint(options.body);
      const key = options.idempotencyKey ?? crypto.randomUUID();
      lastAttemptRef.current = { key, url: options.url, body: fingerprint };
      inFlightRef.current = true;
      setPending(true);
      setInlineError(null);
      const correlationId = crypto.randomUUID();
      try {
        const response = await fetch(options.url, {
          method: options.method ?? "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
            [CORRELATION_HEADER_NAME]: correlationId,
          },
          body: fingerprint === undefined ? undefined : fingerprint,
          credentials: "same-origin",
        });

        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }

        if (response.status === 401 && typeof window !== "undefined" && !isDevGalleryPath()) {
          window.location.href = signInHref();
          return null;
        }

        if (!response.ok || isPublicErrorBody(body)) {
          const resolvedCorrelation = isPublicErrorBody(body)
            ? body.error.correlationId
            : response.headers.get(CORRELATION_HEADER_NAME);
          const failure: WorkspaceActionFailure = {
            message: isPublicErrorBody(body)
              ? body.error.message
              : (options.failureMessage ?? "Something went wrong."),
            reference: resolvedCorrelation ? referenceSnippet(resolvedCorrelation) : null,
            retryable: isPublicErrorBody(body) ? body.error.retryable : true,
            errorCode: isPublicErrorBody(body) ? body.error.errorCode : undefined,
          };
          setInlineError(failure);
          options.onFailure?.(failure);
          router.refresh();
          return null;
        }

        lastAttemptRef.current = null;
        if (options.refreshOnSuccess !== false) {
          router.refresh();
        }
        return body;
      } catch (error) {
        const failure: WorkspaceActionFailure = isNetworkFailure(error)
          ? { message: NETWORK_MESSAGE, reference: null, retryable: true }
          : { message: options.failureMessage ?? "Something went wrong.", reference: null, retryable: true };
        setInlineError(failure);
        options.onFailure?.(failure);
        router.refresh();
        return null;
      } finally {
        inFlightRef.current = false;
        setPending(false);
      }
    },
    [router, signInHref],
  );

  const clearError = useCallback(() => setInlineError(null), []);

  const retrySameKey = useCallback(
    (options: Omit<WorkspaceActionRunOptions, "idempotencyKey">) => {
      const stored = lastAttemptRef.current;
      if (!stored || stored.url !== options.url || stored.body !== bodyFingerprint(options.body)) {
        return run(options);
      }
      return run({
        ...options,
        idempotencyKey: stored.key,
      });
    },
    [run],
  );

  return { pending, pendingLabel: pending ? "Saving…" : null, inlineError, run, retrySameKey, clearError };
}