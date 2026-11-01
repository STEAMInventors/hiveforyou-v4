"use client";

import type {
  CompleteSourceDocumentRequest,
  CompleteSourceDocumentResponse,
  CreateIntentRequestRequest,
  CreateIntentRequestResponse,
  GetUploadQuotaResponse,
  ListSourceDocumentsResponse,
  PrepareSourceDocumentRequest,
  PrepareSourceDocumentResponse,
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

export async function sha256HexFromFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function prepareSourceDocumentUpload(
  hiveId: string,
  payload: PrepareSourceDocumentRequest,
): Promise<PrepareSourceDocumentResponse> {
  return requestJson(hivePath(hiveId, "/source-documents"), "Could not prepare this upload. Try again.", {
    method: "POST",
    body: payload,
  });
}

export function completeSourceDocumentUpload(
  hiveId: string,
  payload: CompleteSourceDocumentRequest,
): Promise<CompleteSourceDocumentResponse> {
  return requestJson(
    hivePath(hiveId, "/source-documents/complete"),
    "This file didn't upload. Try again.",
    { method: "POST", body: payload },
  );
}

/** Direct-to-Storage upload using a signed upload token from prepare. */
export async function uploadFileToSignedTarget(
  file: File,
  target: { path: string; token: string },
): Promise<void> {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured for direct uploads.");
  }
  const client = createClient(url, anonKey);
  const { error } = await client.storage
    .from("hive-source-documents")
    .uploadToSignedUrl(target.path, target.token, file, { upsert: false });
  if (error) {
    throw error;
  }
}

/** prepare → signed Storage upload → complete; file bytes never pass through the app server. */
export async function uploadSourceDocument(
  hiveId: string,
  input: { file: File; clientRequestId: string },
): Promise<CompleteSourceDocumentResponse> {
  const { validateSourceFileCandidate } = await import("@hiveforyou/contracts");
  const validation = validateSourceFileCandidate({ name: input.file.name, size: input.file.size });
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  const sha256 = await sha256HexFromFile(input.file);
  const prepared = await prepareSourceDocumentUpload(hiveId, {
    fileName: validation.value.fileName,
    mimeType: validation.value.mimeType,
    byteSize: validation.value.byteSize,
    sha256,
    clientRequestId: input.clientRequestId,
  });
  if (prepared.sourceDocument.status === "REJECTED") {
    return { sourceDocument: prepared.sourceDocument };
  }
  if (prepared.sourceDocument.status === "REGISTERED") {
    return { sourceDocument: prepared.sourceDocument };
  }
  if (!prepared.upload) {
    throw new Error("Upload could not be prepared.");
  }
  await uploadFileToSignedTarget(input.file, prepared.upload);
  return completeSourceDocumentUpload(hiveId, { clientRequestId: input.clientRequestId });
}
