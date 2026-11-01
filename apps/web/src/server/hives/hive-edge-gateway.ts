import {
  createHiveError,
  isValidUuid,
  normalizeHiveRecord,
  validateCreateHiveInput,
  type CreateHiveResponse,
  type GetHiveResponse,
  type Hive,
  type ListHivesResponse,
  type ValidatedCreateHiveInput,
} from "@hiveforyou/contracts";

import {
  invokeEdgeFunction,
  unexpectedEdgeShape,
  type EdgeSupabaseClient,
} from "@/server/edge/invoke-edge-function";

export type { EdgeSupabaseClient } from "@/server/edge/invoke-edge-function";

const EDGE_FUNCTION_NAME = "v1-hives";
const SAVE_UNCONFIRMED_MESSAGE =
  "We could not confirm whether your Hive was saved. Try again with the same request.";

function invokeHives(
  client: EdgeSupabaseClient,
  correlationId: string,
  body: Record<string, unknown>,
) {
  return invokeEdgeFunction(client, {
    functionName: EDGE_FUNCTION_NAME,
    correlationId,
    body,
    timeoutMessage: SAVE_UNCONFIRMED_MESSAGE,
  });
}

export async function listHivesViaEdge(
  client: EdgeSupabaseClient,
  correlationId: string,
): Promise<ListHivesResponse> {
  const result = await invokeHives(client, correlationId, { op: "list" });
  if (!result.ok) {
    throw result.error;
  }
  const rawList = result.data.hives;
  if (!Array.isArray(rawList)) {
    throw unexpectedEdgeShape(correlationId);
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

  const result = await invokeHives(client, correlationId, {
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
    throw unexpectedEdgeShape(correlationId);
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

  const result = await invokeHives(client, correlationId, {
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
    throw unexpectedEdgeShape(correlationId);
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
  const result = await invokeHives(client, correlationId, {
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
      safeMessage: SAVE_UNCONFIRMED_MESSAGE,
      correlationId,
      diagnosticReason: "unexpected_edge_shape",
    });
  }

  const created = result.data.created !== false;
  return { hive, created };
}
