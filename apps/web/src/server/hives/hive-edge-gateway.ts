import {
  createHiveError,
  isErrorCategory,
  isErrorCode,
  isValidUuid,
  normalizeHiveRecord,
  validateCreateHiveInput,
  type CreateHiveResponse,
  type GetHiveResponse,
  type Hive,
  type HiveError,
  type ListHivesResponse,
  type ValidatedCreateHiveInput,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CORRELATION_HEADER } from "@/server/observability/correlation";

const EDGE_FUNCTION_NAME = "v1-hives";
const INVOKE_TIMEOUT_MS = 8000;
const MAX_TRANSIENT_ATTEMPTS = 2;

export type EdgeSupabaseClient = Pick<SupabaseClient, "auth" | "functions">;

async function getAccessToken(client: EdgeSupabaseClient): Promise<string | null> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    return null;
  }
  return data.session.access_token;
}

async function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs = INVOKE_TIMEOUT_MS,
): Promise<T> {
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

function extractEdgeErrorRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const top = body as Record<string, unknown>;
  const nested = top.error;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return top;
}

function parseEdgeErrorBody(
  body: unknown,
  correlationId: string,
): HiveError | null {
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
  const category = isErrorCategory(rawCategory)
    ? rawCategory
    : mappedCode === "UNAUTHENTICATED" ||
        mappedCode === "ACCESS_DENIED" ||
        mappedCode === "NOT_FOUND"
      ? "SECURITY"
      : mappedCode === "INVALID_REQUEST"
        ? "VALIDATION"
        : "PERSISTENCE";

  const safeMessage =
    typeof record.message === "string" && record.message.trim().length > 0
      ? record.message
      : typeof record.message_safe === "string" &&
          record.message_safe.trim().length > 0
        ? record.message_safe
        : mappedCode === "IDEMPOTENCY_CONFLICT"
          ? "This create request ID was already used with different Hive details."
          : mappedCode === "NOT_FOUND"
            ? "We could not find that Hive."
            : mappedCode === "ACCESS_DENIED"
              ? "You do not have access to this Hive."
              : mappedCode === "UNAUTHENTICATED"
                ? "Sign in to continue."
                : "Something went wrong. Please try again.";

  const retryable =
    typeof record.retryable === "boolean"
      ? record.retryable
      : mappedCode === "PERSISTENCE_FAILED";

  const diagnosticReason =
    typeof record.diagnosticReason === "string"
      ? record.diagnosticReason
      : typeof record.diagnostic_detail === "string"
        ? record.diagnostic_detail
        : mappedCode === "IDEMPOTENCY_CONFLICT"
          ? "idempotency_conflict"
          : mappedCode === "NOT_FOUND"
            ? "not_found"
            : mappedCode === "ACCESS_DENIED"
              ? "access_denied"
              : mappedCode === "UNAUTHENTICATED"
                ? "no_session"
                : mappedCode === "INVALID_REQUEST"
                  ? "invalid_request"
                  : "persistence_failed";

  return createHiveError({
    errorCode: mappedCode,
    category,
    stage: "SHELL",
    retryable,
    safeMessage,
    correlationId,
    diagnosticReason,
  });
}

async function invokeEdgeOnce(
  client: EdgeSupabaseClient,
  correlationId: string,
  body: Record<string, unknown>,
  timeoutMs = INVOKE_TIMEOUT_MS,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: HiveError }> {
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
      client.functions.invoke(EDGE_FUNCTION_NAME, {
        body,
        headers: {
          Authorization: `Bearer ${token}`,
          [CORRELATION_HEADER]: correlationId,
        },
      }),
      timeoutMs,
    );

    if (error) {
      let contextBody: unknown =
        typeof error === "object" && error && "context" in error
          ? (error as { context?: { body?: unknown; json?: () => Promise<unknown> } })
              .context?.body
          : undefined;

      if (
        contextBody === undefined &&
        typeof error === "object" &&
        error &&
        "context" in error
      ) {
        const ctx = (error as { context?: { json?: () => Promise<unknown> } })
          .context;
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
        error: createHiveError({
          errorCode: "PERSISTENCE_FAILED",
          category: "PERSISTENCE",
          stage: "SHELL",
          retryable: true,
          safeMessage: "Something went wrong. Please try again.",
          correlationId,
          diagnosticReason: "edge_invoke_error",
          cause: error,
        }),
      };
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {
        ok: false,
        error: createHiveError({
          errorCode: "PERSISTENCE_FAILED",
          category: "PERSISTENCE",
          stage: "SHELL",
          retryable: true,
          safeMessage: "Something went wrong. Please try again.",
          correlationId,
          diagnosticReason: "empty_edge_payload",
        }),
      };
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
      error: createHiveError({
        errorCode: "PERSISTENCE_FAILED",
        category: "PERSISTENCE",
        stage: "SHELL",
        retryable: true,
        safeMessage: isTimeout
          ? "We could not confirm whether your Hive was saved. Try again with the same request."
          : "Something went wrong. Please try again.",
        correlationId,
        diagnosticReason: isTimeout ? "timeout" : "edge_invoke_error",
        cause: thrown,
      }),
    };
  }
}

async function invokeEdgeWithBoundedRetry(
  client: EdgeSupabaseClient,
  correlationId: string,
  body: Record<string, unknown>,
  timeoutMs = INVOKE_TIMEOUT_MS,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: HiveError }> {
  let lastFailure: HiveError | null = null;
  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    const result = await invokeEdgeOnce(client, correlationId, body, timeoutMs);
    if (result.ok) {
      return result;
    }
    lastFailure = result.error;
    if (!result.error.retryable || attempt === MAX_TRANSIENT_ATTEMPTS) {
      return result;
    }
  }
  return {
    ok: false,
    error:
      lastFailure ??
      createHiveError({
        errorCode: "PERSISTENCE_FAILED",
        category: "PERSISTENCE",
        stage: "SHELL",
        retryable: true,
        safeMessage: "Something went wrong. Please try again.",
        correlationId,
        diagnosticReason: "persistence_failed",
      }),
  };
}

export async function listHivesViaEdge(
  client: EdgeSupabaseClient,
  correlationId: string,
): Promise<ListHivesResponse> {
  const result = await invokeEdgeWithBoundedRetry(client, correlationId, {
    op: "list",
  });
  if (!result.ok) {
    throw result.error;
  }
  const rawList = result.data.hives;
  if (!Array.isArray(rawList)) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage: "Something went wrong. Please try again.",
      correlationId,
      diagnosticReason: "unexpected_edge_shape",
    });
  }
  const hives: Hive[] = [];
  for (const item of rawList) {
    const normalized = normalizeHiveRecord(item);
    if (normalized) {
      hives.push(normalized);
    }
  }
  return { hives };
}

export async function getHiveViaEdge(
  client: EdgeSupabaseClient,
  hiveId: string,
  correlationId: string,
): Promise<GetHiveResponse> {
  const trimmed = hiveId.trim().toLowerCase();
  if (!isValidUuid(trimmed)) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Invalid Hive identifier.",
      correlationId,
      diagnosticReason: "invalid_hive_id",
    });
  }

  const result = await invokeEdgeWithBoundedRetry(client, correlationId, {
    op: "get",
    hiveId: trimmed,
    hive_id: trimmed,
  });
  if (!result.ok) {
    throw result.error;
  }

  if (result.data.hive === null || result.data.hive === undefined) {
    throw createHiveError({
      errorCode: "NOT_FOUND",
      category: "SECURITY",
      stage: "SHELL",
      retryable: false,
      safeMessage: "We could not find that Hive.",
      correlationId,
      diagnosticReason: "not_found",
    });
  }

  const hive = normalizeHiveRecord(result.data.hive);
  if (!hive) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage: "Something went wrong. Please try again.",
      correlationId,
      diagnosticReason: "unexpected_edge_shape",
    });
  }

  return { hive };
}

export async function getHiveByClientRequestIdViaEdge(
  client: EdgeSupabaseClient,
  clientRequestId: string,
  correlationId: string,
): Promise<Hive | null> {
  const trimmed = clientRequestId.trim().toLowerCase();
  if (!isValidUuid(trimmed)) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: "clientRequestId must be a valid UUID.",
      correlationId,
      diagnosticReason: "invalid_client_request_id",
    });
  }

  const result = await invokeEdgeWithBoundedRetry(client, correlationId, {
    op: "get_by_client_request_id",
    clientRequestId: trimmed,
    client_request_id: trimmed,
  });
  if (!result.ok) {
    throw result.error;
  }

  if (result.data.hive === null || result.data.hive === undefined) {
    return null;
  }

  const hive = normalizeHiveRecord(result.data.hive);
  if (!hive) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage: "Something went wrong. Please try again.",
      correlationId,
      diagnosticReason: "unexpected_edge_shape",
    });
  }
  return hive;
}

export async function createHiveViaEdge(
  client: EdgeSupabaseClient,
  rawBody: unknown,
  correlationId: string,
): Promise<CreateHiveResponse> {
  const validated = validateCreateHiveInput(rawBody);
  if (!validated.ok) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: validated.message,
      correlationId,
      diagnosticReason: validated.diagnosticReason,
    });
  }

  const input: ValidatedCreateHiveInput = validated.value;
  const result = await invokeEdgeWithBoundedRetry(client, correlationId, {
    op: "create",
    name: input.name,
    description: input.description,
    clientRequestId: input.clientRequestId,
    client_request_id: input.clientRequestId,
  });

  if (!result.ok) {
    throw result.error;
  }

  const hive = normalizeHiveRecord(result.data.hive);
  if (!hive) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      retryable: true,
      safeMessage:
        "We could not confirm whether your Hive was saved. Try again with the same request.",
      correlationId,
      diagnosticReason: "unexpected_edge_shape",
    });
  }

  const created = result.data.created !== false;
  return { hive, created };
}
