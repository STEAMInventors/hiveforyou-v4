import {
  createHiveError,
  type HiveError,
  isValidUuid,
  normalizeSupportDiagnostics,
  type SupportDiagnostic,
} from "@hiveforyou/contracts";

import type { DocumentPageRpcClient } from "@/server/source-documents/document-pages-persistence";

/**
 * Owner lookup of a support reference. Returns only the safe diagnostic rows for that Hive.
 * Raw logs, prompts, model text and network locations are not stored here and are not returned.
 */
export async function getFailureDiagnostics(
  client: DocumentPageRpcClient,
  input: { hiveId: string; correlationId: string; reference: string },
): Promise<{ correlationId: string; diagnostics: SupportDiagnostic[] }> {
  const hiveId = input.hiveId.trim().toLowerCase();
  const reference = input.reference.trim().toLowerCase();
  if (!isValidUuid(hiveId) || !isValidUuid(reference)) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "ANALYZE",
      retryable: false,
      safeMessage: "That support reference is not valid.",
      correlationId: input.correlationId,
      diagnosticReason: "invalid_request",
    });
  }
  const { data, error } = await client.rpc("get_failure_diagnostics", {
    p_hive_id: hiveId,
    p_correlation_id: reference,
  });
  if (error) throw mapLookupError(error, input.correlationId);
  const payload = typeof data === "string" ? safeJson(data) : data;
  const normalized = normalizeSupportDiagnostics(payload);
  if (!normalized || normalized.correlationId !== reference) {
    throw createHiveError({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "ANALYZE",
      retryable: false,
      safeMessage: "We could not read the diagnostic for that reference.",
      correlationId: input.correlationId,
      diagnosticReason: "unexpected_edge_shape",
    });
  }
  return normalized;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function mapLookupError(error: { message?: string }, correlationId: string): HiveError {
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("auth_required")) {
    return createHiveError({
      errorCode: "UNAUTHENTICATED",
      category: "SECURITY",
      stage: "ANALYZE",
      retryable: false,
      safeMessage: "Sign in to look up a support reference.",
      correlationId,
      diagnosticReason: "no_session",
    });
  }
  if (message.includes("hive_not_found") || message.includes("access_denied")) {
    return createHiveError({
      errorCode: "NOT_FOUND",
      category: "SECURITY",
      stage: "ANALYZE",
      retryable: false,
      safeMessage: "We could not find that Hive.",
      correlationId,
      diagnosticReason: "not_found",
    });
  }
  return createHiveError({
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "ANALYZE",
    retryable: false,
    safeMessage: "We could not look up that support reference.",
    correlationId,
    diagnosticReason: "persistence_failed",
  });
}
