import {
  createHiveError,
  isErrorCategory,
  isErrorCode,
  isProcessingStage,
  type HiveError,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CORRELATION_HEADER } from "@/server/observability/correlation";

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TRANSIENT_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MESSAGE =
  "We could not confirm whether this was saved. Try again with the same request.";

export type EdgeSupabaseClient = Pick<SupabaseClient, "auth" | "functions">;

export type EdgeInvokeResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: HiveError };

export type EdgeInvokeOptions = {
  functionName: string;
  correlationId: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
  timeoutMessage?: string;
  maxAttempts?: number;
};

async function getAccessToken(client: EdgeSupabaseClient): Promise<string | null> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    return null;
  }
  return data.session.access_token;
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error("edge_invoke_timeout");
      err.name = "AbortError";
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function coerceJsonBody(body: unknown): unknown {
  if (typeof body !== "string") {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function extractEdgeErrorRecord(body: unknown): Record<string, unknown> | null {
  const coerced = coerceJsonBody(body);
  if (!coerced || typeof coerced !== "object" || Array.isArray(coerced)) {
    return null;
  }
  const top = coerced as Record<string, unknown>;
  const nested = top.error;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return top;
}

function fallbackCategory(code: string): HiveError["category"] {
  switch (code) {
    case "UNAUTHENTICATED":
    case "ACCESS_DENIED":
    case "NOT_FOUND":
      return "SECURITY";
    case "INVALID_REQUEST":
    case "QUOTA_EXCEEDED":
      return "VALIDATION";
    case "INVALID_DOCUMENT":
      return "DOCUMENT";
    default:
      return "PERSISTENCE";
  }
}

function fallbackMessage(code: string): string {
  switch (code) {
    case "IDEMPOTENCY_CONFLICT":
      return "This create request ID was already used with different Hive details.";
    case "NOT_FOUND":
      return "We could not find that Hive.";
    case "ACCESS_DENIED":
      return "You do not have access to this Hive.";
    case "UNAUTHENTICATED":
      return "Sign in to continue.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function fallbackDiagnosticReason(code: string): string {
  switch (code) {
    case "IDEMPOTENCY_CONFLICT":
      return "idempotency_conflict";
    case "NOT_FOUND":
      return "not_found";
    case "ACCESS_DENIED":
      return "access_denied";
    case "UNAUTHENTICATED":
      return "no_session";
    case "INVALID_REQUEST":
      return "invalid_request";
    case "QUOTA_EXCEEDED":
      return "quota_exceeded";
    case "INVALID_DOCUMENT":
      return "invalid_document_type";
    default:
      return "persistence_failed";
  }
}

export function parseEdgeErrorBody(body: unknown, correlationId: string): HiveError | null {
  const record = extractEdgeErrorRecord(body);
  if (!record) {
    return null;
  }
  const rawCode =
    typeof record.errorCode === "string"
      ? record.errorCode
      : typeof record.error_code === "string"
        ? record.error_code
        : null;
  if (!rawCode) {
    return null;
  }

  const mappedCode =
    rawCode === "AUTH_FAILED"
      ? "UNAUTHENTICATED"
      : rawCode === "DEPENDENCY_UNAVAILABLE" ||
          rawCode === "DB_TRANSIENT" ||
          rawCode === "DB_OUTCOME_UNKNOWN"
        ? "PERSISTENCE_FAILED"
        : isErrorCode(rawCode)
          ? rawCode
          : "PERSISTENCE_FAILED";

  const rawCategory =
    typeof record.category === "string" ? record.category.toUpperCase() : "";
  const rawStage = typeof record.stage === "string" ? record.stage : "";

  const safeMessage =
    typeof record.message === "string" && record.message.trim().length > 0
      ? record.message
      : typeof record.message_safe === "string" && record.message_safe.trim().length > 0
        ? record.message_safe
        : fallbackMessage(mappedCode);

  return createHiveError({
    errorCode: mappedCode,
    category: isErrorCategory(rawCategory) ? rawCategory : fallbackCategory(mappedCode),
    stage: isProcessingStage(rawStage) ? rawStage : "SHELL",
    retryable:
      typeof record.retryable === "boolean"
        ? record.retryable
        : mappedCode === "PERSISTENCE_FAILED",
    safeMessage,
    correlationId,
    diagnosticReason:
      typeof record.diagnosticReason === "string"
        ? record.diagnosticReason
        : typeof record.diagnostic_detail === "string"
          ? record.diagnostic_detail
          : fallbackDiagnosticReason(mappedCode),
  });
}

function persistenceError(
  correlationId: string,
  diagnosticReason: string,
  safeMessage = "Something went wrong. Please try again.",
  cause?: unknown,
): HiveError {
  return createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "SHELL",
    retryable: true,
    safeMessage,
    correlationId,
    diagnosticReason,
    cause,
  });
}

async function invokeEdgeOnce(
  client: EdgeSupabaseClient,
  options: EdgeInvokeOptions,
): Promise<EdgeInvokeResult> {
  const { functionName, correlationId, body } = options;
  const token = await getAccessToken(client);
  if (!token) {
    return {
      ok: false,
      error: createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to continue.",
        correlationId,
        diagnosticReason: "no_session",
      }),
    };
  }

  try {
    const { data, error } = await withTimeout(
      client.functions.invoke(functionName, {
        body,
        headers: {
          Authorization: `Bearer ${token}`,
          [CORRELATION_HEADER]: correlationId,
        },
      }),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    if (error) {
      let contextBody: unknown =
        typeof error === "object" && error && "context" in error
          ? (error as { context?: { body?: unknown } }).context?.body
          : undefined;

      if (contextBody === undefined && typeof error === "object" && error && "context" in error) {
        const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            contextBody = await ctx.json();
          } catch {
            contextBody = undefined;
          }
        }
      }

      const parsed = parseEdgeErrorBody(contextBody ?? data, correlationId);
      if (parsed) {
        return { ok: false, error: parsed };
      }
      return {
        ok: false,
        error: persistenceError(correlationId, "edge_invoke_error", undefined, error),
      };
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: persistenceError(correlationId, "empty_edge_payload") };
    }

    const record = data as Record<string, unknown>;
    const maybeError = parseEdgeErrorBody(record, correlationId);
    if (maybeError) {
      return { ok: false, error: maybeError };
    }

    return { ok: true, data: record };
  } catch (thrown) {
    const isTimeout =
      thrown instanceof Error &&
      (thrown.name === "AbortError" || thrown.message === "edge_invoke_timeout");
    return {
      ok: false,
      error: persistenceError(
        correlationId,
        isTimeout ? "timeout" : "edge_invoke_error",
        isTimeout
          ? (options.timeoutMessage ?? DEFAULT_TIMEOUT_MESSAGE)
          : "Something went wrong. Please try again.",
        thrown,
      ),
    };
  }
}

/** Retries only failures the Edge Function marks retryable; callers must send idempotent operations. */
export async function invokeEdgeFunction(
  client: EdgeSupabaseClient,
  options: EdgeInvokeOptions,
): Promise<EdgeInvokeResult> {
  let result: EdgeInvokeResult = {
    ok: false,
    error: persistenceError(options.correlationId, "persistence_failed"),
  };
  const maxAttempts = options.maxAttempts ?? MAX_TRANSIENT_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await invokeEdgeOnce(client, options);
    if (result.ok || !result.error.retryable) {
      return result;
    }
  }
  return result;
}

export function unexpectedEdgeShape(correlationId: string): HiveError {
  return persistenceError(correlationId, "unexpected_edge_shape");
}
