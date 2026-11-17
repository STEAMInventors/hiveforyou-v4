"use client";

import type { PublicErrorBody } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { CORRELATION_HEADER_NAME } from "@/lib/hives-client";

export type WorkspaceActionFailure = {
  message: string;
  reference: string | null;
};

export type WorkspaceActionRunOptions = {
  url: string;
  method?: "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Reuse the same key for Try again; generate a fresh key for a new attempt. */
  idempotencyKey?: string;
  failureMessage?: string;
  refreshOnSuccess?: boolean;
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

export function useWorkspaceAction(signInNextPath?: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [inlineError, setInlineError] = useState<WorkspaceActionFailure | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const run = useCallback(
    async (options: WorkspaceActionRunOptions): Promise<boolean> => {
      if (inFlightRef.current) return false;
      const key = options.idempotencyKey ?? lastKeyRef.current ?? crypto.randomUUID();
      lastKeyRef.current = key;
      inFlightRef.current = true;
      setPending(true);
      setInlineError(null);
      try {
        const response = await fetch(options.url, {
          method: options.method ?? "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
            [CORRELATION_HEADER_NAME]: key,
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          credentials: "same-origin",
        });

        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }

        if (response.status === 401 && typeof window !== "undefined") {
          const next = encodeURIComponent(signInNextPath ?? window.location.pathname);
          window.location.href = `/sign-in?next=${next}`;
          return false;
        }

        if (!response.ok || isPublicErrorBody(body)) {
          const correlationId = isPublicErrorBody(body)
            ? body.error.correlationId
            : response.headers.get(CORRELATION_HEADER_NAME);
          setInlineError({
            message: isPublicErrorBody(body)
              ? body.error.message
              : (options.failureMessage ?? "Something went wrong."),
            reference: correlationId ? referenceSnippet(correlationId) : null,
          });
          return false;
        }

        if (options.refreshOnSuccess !== false) {
          router.refresh();
        }
        return true;
      } finally {
        inFlightRef.current = false;
        setPending(false);
      }
    },
    [router, signInNextPath],
  );

  const clearError = useCallback(() => setInlineError(null), []);

  const retrySameKey = useCallback(
    (options: Omit<WorkspaceActionRunOptions, "idempotencyKey">) =>
      run({
        ...options,
        idempotencyKey: lastKeyRef.current ?? undefined,
      }),
    [run],
  );

  return { pending, pendingLabel: pending ? "Saving…" : null, inlineError, run, retrySameKey, clearError };
}