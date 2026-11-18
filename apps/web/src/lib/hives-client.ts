"use client";

import type {
  CreateHiveRequest,
  CreateHiveResponse,
  DeleteHiveResponse,
  GetHiveResponse,
  ListHivesResponse,
} from "@hiveforyou/contracts";

import { CORRELATION_HEADER_NAME, HiveClientError, parseApiJson } from "./hive-api-client";

export { CORRELATION_HEADER_NAME, HiveClientError, parseApiJson };

export async function fetchMyHives(): Promise<ListHivesResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch("/api/v1/hives", {
    headers: { [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
  });
  return parseApiJson<ListHivesResponse>(response, correlationId, "Could not load your Hives.");
}

export async function fetchHive(hiveId: string): Promise<GetHiveResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(`/api/v1/hives/${encodeURIComponent(hiveId)}`, {
    headers: { [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
  });
  return parseApiJson<GetHiveResponse>(response, correlationId, "We could not find that Hive.");
}

export async function createHive(payload: CreateHiveRequest): Promise<CreateHiveResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch("/api/v1/hives", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [CORRELATION_HEADER_NAME]: correlationId,
    },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  return parseApiJson<CreateHiveResponse>(response, correlationId, "Could not create your Hive. Please try again.");
}

export async function setHiveKind(hiveId: string, kind: "own" | "client"): Promise<void> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(`/api/v1/hives/${encodeURIComponent(hiveId)}/kind`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [CORRELATION_HEADER_NAME]: correlationId,
    },
    credentials: "same-origin",
    body: JSON.stringify({ kind }),
  });
  await parseApiJson<{ ok: true }>(response, correlationId, "Could not update this Hive.");
}

export async function deleteHive(hiveId: string): Promise<DeleteHiveResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(`/api/v1/hives/${encodeURIComponent(hiveId)}`, {
    method: "DELETE",
    headers: { [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
  });
  return parseApiJson<DeleteHiveResponse>(response, correlationId, "Could not delete this Hive. Try again.");
}