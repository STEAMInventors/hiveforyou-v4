"use client";

import type {
  ListDocumentReadsResponse,
  StartDocumentReadsRequest,
  StartDocumentReadsResponse,
} from "@hiveforyou/contracts";

import { CORRELATION_HEADER_NAME, parseApiJson } from "./hives-client";

function documentReadsPath(hiveId: string): string {
  return `/api/v1/hives/${encodeURIComponent(hiveId)}/document-reads`;
}

export async function fetchDocumentReads(hiveId: string): Promise<ListDocumentReadsResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(documentReadsPath(hiveId), {
    headers: { [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
    cache: "no-store",
  });
  return parseApiJson<ListDocumentReadsResponse>(
    response,
    correlationId,
    "Could not load reading progress.",
  );
}

export async function startDocumentReads(
  hiveId: string,
  payload: StartDocumentReadsRequest,
): Promise<StartDocumentReadsResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(documentReadsPath(hiveId), {
    method: "POST",
    headers: { "Content-Type": "application/json", [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  return parseApiJson<StartDocumentReadsResponse>(
    response,
    correlationId,
    "Could not start reading your documents. Try again.",
  );
}
