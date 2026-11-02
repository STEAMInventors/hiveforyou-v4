import { isValidUuid } from "../hives/hive-contracts";
import type { ContractValidation, SourceDocument } from "./source-document-contracts";

/** Mirrored in supabase/migrations/20261101200000_create_document_reads.sql. */
export const DOCUMENT_READ_STATUSES = [
  "QUEUED",
  "READING",
  "SAVING",
  "VERIFYING",
  "SUCCEEDED",
  "PARTIAL",
  "UNREADABLE",
  "FAILED",
] as const;
export type DocumentReadStatus = (typeof DOCUMENT_READ_STATUSES)[number];

export const ACTIVE_DOCUMENT_READ_STATUSES = ["QUEUED", "READING", "SAVING", "VERIFYING"] as const;
export type ActiveDocumentReadStatus = (typeof ACTIVE_DOCUMENT_READ_STATUSES)[number];

export const MAX_DOCUMENT_READS_PER_REQUEST = 50;

/** One attempt to read one source document, as shown to the owner. Never carries page text. */
export type DocumentRead = {
  id: string;
  hiveId: string;
  sourceDocumentId: string;
  requestId: string;
  attemptNumber: number;
  status: DocumentReadStatus;
  totalPhysicalPages: number | null;
  verifiedPageCount: number | null;
  unreadablePageCount: number | null;
  errorCode: string | null;
  errorMessageSafe: string | null;
  retryable: boolean | null;
  correlationId: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};

export type StartDocumentReadsRequest = {
  clientRequestId: string;
  sourceDocumentIds?: string[];
};

export type StartDocumentReadsResponse = {
  documentReads: DocumentRead[];
  created: number;
};

export type ListDocumentReadsResponse = {
  documentReads: DocumentRead[];
};

export function isDocumentReadStatus(value: unknown): value is DocumentReadStatus {
  return typeof value === "string" && (DOCUMENT_READ_STATUSES as readonly string[]).includes(value);
}

export function isActiveDocumentReadStatus(value: unknown): value is ActiveDocumentReadStatus {
  return (
    typeof value === "string" && (ACTIVE_DOCUMENT_READ_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalDocumentReadStatus(value: unknown): boolean {
  return isDocumentReadStatus(value) && !isActiveDocumentReadStatus(value);
}

/** Registered documents that were never read, or whose last read failed, can be (re)read. */
export function documentNeedsReading(
  document: Pick<SourceDocument, "status" | "readStatus">,
  latestRead: Pick<DocumentRead, "status"> | null | undefined,
): boolean {
  if (document.status !== "REGISTERED") {
    return false;
  }
  if (latestRead && isActiveDocumentReadStatus(latestRead.status)) {
    return false;
  }
  return document.readStatus === "PENDING" || document.readStatus === "FAILED";
}

export function validateStartDocumentReadsInput(
  body: unknown,
): ContractValidation<{ clientRequestId: string; sourceDocumentIds: string[] | null }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
      diagnosticReason: "invalid_payload_shape",
    };
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "clientRequestId" && key !== "sourceDocumentIds") {
      return { ok: false, message: `Unexpected field: ${key}.`, diagnosticReason: "unexpected_field" };
    }
  }
  const clientRequestId =
    typeof record.clientRequestId === "string" ? record.clientRequestId.trim().toLowerCase() : "";
  if (!isValidUuid(clientRequestId)) {
    return {
      ok: false,
      message: "clientRequestId must be a valid UUID.",
      diagnosticReason: "invalid_client_request_id",
    };
  }
  if (record.sourceDocumentIds === undefined) {
    return { ok: true, value: { clientRequestId, sourceDocumentIds: null } };
  }
  const rawIds = record.sourceDocumentIds;
  if (
    !Array.isArray(rawIds) ||
    rawIds.length < 1 ||
    rawIds.length > MAX_DOCUMENT_READS_PER_REQUEST ||
    rawIds.some((id) => typeof id !== "string" || !isValidUuid(id.trim().toLowerCase()))
  ) {
    return {
      ok: false,
      message: "sourceDocumentIds must be a list of document identifiers.",
      diagnosticReason: "invalid_source_document_id",
    };
  }
  const sourceDocumentIds = [...new Set(rawIds.map((id) => (id as string).trim().toLowerCase()))];
  return { ok: true, value: { clientRequestId, sourceDocumentIds } };
}

function nullableInteger(value: unknown): number | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : undefined;
}

export function normalizeDocumentReadRecord(raw: unknown): DocumentRead | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const ids = [record.id, record.hiveId, record.sourceDocumentId, record.requestId, record.correlationId];
  if (ids.some((id) => typeof id !== "string" || !isValidUuid(id.toLowerCase()))) {
    return null;
  }
  if (
    !isDocumentReadStatus(record.status) ||
    typeof record.attemptNumber !== "number" ||
    !Number.isInteger(record.attemptNumber) ||
    record.attemptNumber < 1 ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    return null;
  }
  const totalPhysicalPages = nullableInteger(record.totalPhysicalPages);
  const verifiedPageCount = nullableInteger(record.verifiedPageCount);
  const unreadablePageCount = nullableInteger(record.unreadablePageCount);
  const errorCode = nullableString(record.errorCode);
  const errorMessageSafe = nullableString(record.errorMessageSafe);
  const startedAt = nullableString(record.startedAt);
  const finishedAt = nullableString(record.finishedAt);
  if (
    totalPhysicalPages === undefined ||
    verifiedPageCount === undefined ||
    unreadablePageCount === undefined ||
    errorCode === undefined ||
    errorMessageSafe === undefined ||
    startedAt === undefined ||
    finishedAt === undefined
  ) {
    return null;
  }
  return {
    id: (record.id as string).toLowerCase(),
    hiveId: (record.hiveId as string).toLowerCase(),
    sourceDocumentId: (record.sourceDocumentId as string).toLowerCase(),
    requestId: (record.requestId as string).toLowerCase(),
    attemptNumber: record.attemptNumber,
    status: record.status,
    totalPhysicalPages,
    verifiedPageCount,
    unreadablePageCount,
    errorCode,
    errorMessageSafe,
    retryable: typeof record.retryable === "boolean" ? record.retryable : null,
    correlationId: (record.correlationId as string).toLowerCase(),
    createdAt: record.createdAt,
    startedAt,
    updatedAt: record.updatedAt,
    finishedAt,
  };
}
