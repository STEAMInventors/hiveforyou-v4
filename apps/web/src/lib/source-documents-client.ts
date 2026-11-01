"use client";

import type {
  CreateIntentRequestRequest,
  CreateIntentRequestResponse,
  GetUploadQuotaResponse,
  ListSourceDocumentsResponse,
  RegisterSourceDocumentResponse,
} from "@hiveforyou/contracts";

import { CORRELATION_HEADER_NAME, parseApiJson } from "./hives-client";

function hivePath(hiveId: string, suffix: string): string {
  return `/api/v1/hives/${encodeURIComponent(hiveId)}${suffix}`;
}

async function requestJson<T>(
  url: string,
  fallbackMessage: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      [CORRELATION_HEADER_NAME]: correlationId,
    },
    credentials: "same-origin",
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return parseApiJson<T>(response, correlationId, fallbackMessage);
}

export function fetchSourceDocuments(hiveId: string): Promise<ListSourceDocumentsResponse> {
  return requestJson(hivePath(hiveId, "/source-documents"), "Could not load your documents.");
}

export function fetchUploadQuota(): Promise<GetUploadQuotaResponse> {
  return requestJson("/api/v1/upload-quota", "Could not load your upload allowance.");
}

export function createIntentRequest(
  hiveId: string,
  payload: CreateIntentRequestRequest,
): Promise<CreateIntentRequestResponse> {
  return requestJson(hivePath(hiveId, "/intent-requests"), "Could not save what you need. Please try again.", {
    method: "POST",
    body: payload,
  });
}

/** Uploads the file through the server route backed by V3's registerSourceDocument. */
export async function uploadSourceDocument(
  hiveId: string,
  input: { file: File; clientRequestId: string },
): Promise<RegisterSourceDocumentResponse> {
  const correlationId = crypto.randomUUID();
  const form = new FormData();
  form.set("file", input.file, input.file.name);
  form.set("clientRequestId", input.clientRequestId);

  const response = await fetch(hivePath(hiveId, "/source-documents"), {
    method: "POST",
    headers: {
      [CORRELATION_HEADER_NAME]: correlationId,
    },
    credentials: "same-origin",
    body: form,
  });
  return parseApiJson<RegisterSourceDocumentResponse>(
    response,
    correlationId,
    "This file didn't upload. Try again.",
  );
}
