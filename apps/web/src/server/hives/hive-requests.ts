import {
  createHiveError,
  isValidUuid,
  normalizeListRequestsResponse,
  type HiveError,
  type ListRequestsResponse,
  type RequestAction,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { withHttpStatus } from "@/server/hives/map-conversation-rpc-error";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type SupabaseRpcError = { code?: string; message?: string };

export const REQUESTS_LOAD_FAILED = "Could not load requests. Try again.";
export const REQUEST_ACTION_FAILED = "Could not update this request. Try again.";

const FIELD_MESSAGES: Record<string, string> = {
  action: "Request could not be processed.",
  sourceDocumentId: "Choose a document in this hive.",
  response: "Choose one of the answers offered.",
  note: "Keep the note under 1,000 characters.",
  body: "Write a reply of up to 4,000 characters.",
  resolution: "Request could not be processed.",
  title: "Give the request a title of up to 500 characters.",
  detail: "Keep the detail under 1,000 characters.",
  client_request_id: "This reply could not be sent.",
};

function requestError(
  input: { errorCode: HiveError["errorCode"]; category: HiveError["category"]; retryable: boolean; message: string; reason: string },
  correlationId: string,
  httpStatus: number,
  cause?: unknown,
): HiveError {
  return withHttpStatus(
    createHiveError({
      errorCode: input.errorCode,
      category: input.category,
      stage: "SHELL",
      retryable: input.retryable,
      safeMessage: input.message,
      correlationId,
      diagnosticReason: input.reason,
      ...(cause !== undefined ? { cause } : {}),
    }),
    httpStatus,
  );
}

export function requestInvalid(field: string, correlationId: string, cause?: unknown): HiveError {
  return requestError(
    {
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      retryable: false,
      message: FIELD_MESSAGES[field] ?? "Request could not be processed.",
      reason: "invalid_request",
    },
    correlationId,
    400,
    cause,
  );
}

export function requestNotFound(correlationId: string, cause?: unknown): HiveError {
  return requestError(
    { errorCode: "NOT_FOUND", category: "SECURITY", retryable: false, message: "We could not find that request.", reason: "not_found" },
    correlationId,
    404,
    cause,
  );
}

export async function requireRequestRouteUser(rawId: string | undefined, correlationId: string) {
  const hiveId = rawId?.trim().toLowerCase() ?? "";
  if (!isValidUuid(hiveId)) {
    throw requestError(
      { errorCode: "NOT_FOUND", category: "SECURITY", retryable: false, message: "We could not find that hive.", reason: "invalid_hive_id" },
      correlationId,
      404,
    );
  }
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    throw createHiveError({
      errorCode: "UNAUTHENTICATED",
      category: "SECURITY",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Sign in to see requests.",
      correlationId,
      diagnosticReason: auth.diagnosticReason,
    });
  }
  return { hiveId, auth };
}

/** One mapper for request RPCs; the public message never carries RPC text. */
export function mapRequestRpcError(error: SupabaseRpcError, correlationId: string, fallback: string): HiveError {
  const code = typeof error.code === "string" ? error.code.trim() : "";
  const lowered = (typeof error.message === "string" ? error.message : "").toLowerCase();

  if (lowered.includes("hive_not_found") || lowered.includes("request_not_found") || lowered.includes("document_not_found")) {
    return requestNotFound(correlationId, error);
  }
  if (code === "42501" || lowered.includes("access_denied")) {
    return requestError(
      { errorCode: "ACCESS_DENIED", category: "SECURITY", retryable: false, message: "You can't do that on this request.", reason: "access_denied" },
      correlationId,
      403,
      error,
    );
  }
  if (
    lowered.includes("invalid_transition") ||
    lowered.includes("request_not_needed") ||
    lowered.includes("document_already_on")
  ) {
    return requestError(
      { errorCode: "INVALID_REQUEST", category: "VALIDATION", retryable: false, message: "This request has changed. Refresh and try again.", reason: "state_conflict" },
      correlationId,
      409,
      error,
    );
  }
  if (lowered.includes("idempotency_conflict")) {
    return requestError(
      { errorCode: "IDEMPOTENCY_CONFLICT", category: "PERSISTENCE", retryable: false, message: "This reply was already sent.", reason: "idempotency_conflict" },
      correlationId,
      409,
      error,
    );
  }
  if (lowered.includes("rate_limited")) {
    return requestError(
      { errorCode: "QUOTA_EXCEEDED", category: "VALIDATION", retryable: true, message: "You're sending messages quickly. Wait a moment and try again.", reason: "rate_limited" },
      correlationId,
      429,
      error,
    );
  }
  if (code === "22023" || lowered.includes("invalid_request")) {
    const field = /invalid_request:([a-z_]+)/i.exec(lowered)?.[1] ?? "";
    return requestInvalid(field, correlationId, error);
  }
  return requestError(
    { errorCode: "PERSISTENCE_FAILED", category: "PERSISTENCE", retryable: true, message: fallback, reason: "persistence_failed" },
    correlationId,
    503,
    error,
  );
}

export async function listHiveRequests(
  client: SupabaseClient,
  hiveId: string,
  correlationId: string,
): Promise<ListRequestsResponse> {
  const { data, error } = await client.rpc("list_requests", { p_hive_id: hiveId });
  if (error) throw mapRequestRpcError(error, correlationId, REQUESTS_LOAD_FAILED);
  const listed = normalizeListRequestsResponse(data);
  if (!listed) {
    throw requestError(
      { errorCode: "PERSISTENCE_FAILED", category: "PERSISTENCE", retryable: true, message: REQUESTS_LOAD_FAILED, reason: "invalid_payload_shape" },
      correlationId,
      503,
    );
  }
  return listed;
}

export type RequestActionResult = { notifyUserIds: readonly string[]; duplicate: boolean };

/** Runs one action on a request that must belong to `hiveId`. Authorization stays in the RPCs. */
export async function runRequestAction(
  client: SupabaseClient,
  input: { hiveId: string; requestId: string; action: RequestAction; clientRequestId: string | null },
  correlationId: string,
): Promise<RequestActionResult> {
  const listed = await listHiveRequests(client, input.hiveId, correlationId);
  if (!listed.requests.some((row) => row.id.toLowerCase() === input.requestId)) {
    throw requestNotFound(correlationId);
  }

  const { action } = input;
  let rpc: { name: string; args: Record<string, unknown> };
  switch (action.action) {
    case "attach":
      rpc = {
        name: "attach_document_to_request",
        args: { p_request_id: input.requestId, p_source_document_id: action.sourceDocumentId },
      };
      break;
    case "respond":
      rpc = {
        name: "respond_to_request",
        args: { p_request_id: input.requestId, p_response: action.response, p_note: action.note },
      };
      break;
    case "resolve":
      rpc = {
        name: "staff_resolve_request",
        args: { p_request_id: input.requestId, p_action: action.resolution, p_note: action.note },
      };
      break;
    case "reply":
      if (!input.clientRequestId) throw requestInvalid("client_request_id", correlationId);
      rpc = {
        name: "reply_to_request",
        args: { p_request_id: input.requestId, p_body: action.body, p_client_request_id: input.clientRequestId },
      };
      break;
  }

  const { data, error } = await client.rpc(rpc.name, rpc.args);
  if (error) throw mapRequestRpcError(error, correlationId, REQUEST_ACTION_FAILED);

  const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const notifyUserIds = Array.isArray(record.notifyUserIds)
    ? record.notifyUserIds.filter((id): id is string => typeof id === "string")
    : [];
  return { notifyUserIds: action.action === "reply" ? notifyUserIds : [], duplicate: record.duplicate === true };
}
