"use client";

import { normalizeListRequestsResponse, type ListRequestsResponse, type RequestAction } from "@hiveforyou/contracts";

import { CORRELATION_HEADER_NAME, HiveClientError, parseApiJson } from "./hive-api-client";

function requestsPath(hiveId: string): string {
  return `/api/v1/hives/${encodeURIComponent(hiveId)}/requests`;
}

async function postForList(
  path: string,
  body: unknown,
  message: string,
  extraHeaders: Record<string, string> = {},
): Promise<ListRequestsResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", [CORRELATION_HEADER_NAME]: correlationId, ...extraHeaders },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const listed = normalizeListRequestsResponse(await parseApiJson<unknown>(response, correlationId, message));
  if (!listed) {
    throw new HiveClientError({ message, errorCode: "PERSISTENCE_FAILED", retryable: true, correlationId, status: 200 });
  }
  return listed;
}

/** One action on one request; returns the refreshed request list. `idempotencyKey` is required for replies. */
export function postRequestAction(
  hiveId: string,
  requestId: string,
  action: RequestAction,
  idempotencyKey?: string,
): Promise<ListRequestsResponse> {
  return postForList(
    `${requestsPath(hiveId)}/${encodeURIComponent(requestId)}`,
    action,
    "Could not update this request. Try again.",
    idempotencyKey ? { "idempotency-key": idempotencyKey } : {},
  );
}

export function addHiveRequest(hiveId: string, title: string, detail: string | null): Promise<ListRequestsResponse> {
  return postForList(requestsPath(hiveId), { title, detail }, "Could not add the request. Try again.");
}
