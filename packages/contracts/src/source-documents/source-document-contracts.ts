import { isValidUuid } from "../hives/hive-contracts";

/** Mirrored in supabase/migrations (upload quota RPC) and v1-source-documents. */
export const MAX_SOURCE_DOCUMENT_BYTES = 26_214_400;
export const FREE_UPLOADS_PER_UTC_MONTH = 2000;
export const INTENT_TEXT_MAX_LENGTH = 2000;
export const INTENT_AUDIENCE_MAX_LENGTH = 200;
export const SOURCE_FILE_NAME_MAX_LENGTH = 255;

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const ALLOWED_SOURCE_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  DOCX_MIME_TYPE,
] as const;

export type SourceMimeType = (typeof ALLOWED_SOURCE_MIME_TYPES)[number];

export const SOURCE_FILE_ACCEPT = [
  ...ALLOWED_SOURCE_MIME_TYPES,
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".docx",
].join(",");

export const SOURCE_DOCUMENT_STATUSES = ["PENDING", "REGISTERED", "REJECTED"] as const;
export type SourceDocumentStatus = (typeof SOURCE_DOCUMENT_STATUSES)[number];

export const SOURCE_FAILURE_REASONS = [
  "TYPE_MISMATCH",
  "SIZE_MISMATCH",
  "MALWARE_DETECTED",
  "QUOTA_EXCEEDED",
] as const;
export type SourceFailureReason = (typeof SOURCE_FAILURE_REASONS)[number];

export const SCAN_STATUSES = [
  "PENDING",
  "NO_DETECTIONS",
  "UNKNOWN_TO_SCANNER",
  "MALICIOUS",
] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const READ_STATUSES = [
  "PENDING",
  "SUCCEEDED",
  "PARTIAL",
  "UNREADABLE",
  "FAILED",
] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];

export type SourceDocument = {
  id: string;
  sourceDocumentId: string;
  hiveId: string;
  clientRequestId: string;
  fileName: string;
  mimeType: SourceMimeType;
  byteSize: number;
  status: SourceDocumentStatus;
  failureReason: SourceFailureReason | null;
  scanStatus: ScanStatus;
  readStatus: ReadStatus;
  registeredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UploadQuota = {
  limit: number;
  used: number;
  remaining: number;
  periodStart: string;
  periodEnd: string;
};

export type SignedUpload = {
  path: string;
  token: string;
};

export type PrepareSourceDocumentRequest = {
  fileName: string;
  mimeType: SourceMimeType;
  byteSize: number;
  sha256: string;
  clientRequestId: string;
};

export type CompleteSourceDocumentRequest = {
  clientRequestId: string;
};

export type PrepareSourceDocumentResponse = {
  sourceDocument: SourceDocument;
  /** Null when the document is no longer pending (idempotent replay). */
  upload: SignedUpload | null;
  created: boolean;
};

export type RegisterSourceDocumentResponse = {
  sourceDocument: SourceDocument;
};

export type CompleteSourceDocumentResponse = RegisterSourceDocumentResponse;

export type ListSourceDocumentsResponse = {
  sourceDocuments: SourceDocument[];
};

export type GetUploadQuotaResponse = {
  quota: UploadQuota;
};

export type CreateIntentRequestRequest = {
  intentText: string;
  /** Who the result is for, in the owner's words; null when not given. */
  audience?: string | null;
  clientRequestId: string;
};

export type IntentRequest = {
  id: string;
  intentRequestId: string;
  hiveId: string;
  clientRequestId: string;
  createdAt: string;
};

export type CreateIntentRequestResponse = {
  intentRequest: IntentRequest;
  created: boolean;
};

export type ContractValidation<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; diagnosticReason: string; diagnosticField?: string };

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export function isSourceMimeType(value: unknown): value is SourceMimeType {
  return includes(ALLOWED_SOURCE_MIME_TYPES, value);
}

const EXTENSION_MIME_TYPES: Record<string, SourceMimeType> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  docx: DOCX_MIME_TYPE,
};

/** Browsers often report an empty or generic type for DOCX, so the extension decides. */
export function sourceMimeTypeForFileName(fileName: string): SourceMimeType | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) {
    return null;
  }
  return EXTENSION_MIME_TYPES[fileName.slice(dot + 1).toLowerCase()] ?? null;
}

export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export const UNSUPPORTED_FILE_MESSAGE = `Only PDF, PNG, JPG and DOCX files up to ${formatMegabytes(
  MAX_SOURCE_DOCUMENT_BYTES,
)} are supported.`;

const FILE_NAME_FORBIDDEN = /[\u0000-\u001f\u007f/\\]/;

export function validateSourceFileCandidate(file: {
  name: string;
  size: number;
}): ContractValidation<{ fileName: string; mimeType: SourceMimeType; byteSize: number }> {
  const fileName = file.name.trim();
  const mimeType = sourceMimeTypeForFileName(fileName);
  if (!mimeType) {
    return { ok: false, message: UNSUPPORTED_FILE_MESSAGE, diagnosticReason: "invalid_document_type" };
  }
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_SOURCE_DOCUMENT_BYTES) {
    return {
      ok: false,
      message:
        file.size < 1 ? "This file is empty." : UNSUPPORTED_FILE_MESSAGE,
      diagnosticReason: "invalid_document_size",
    };
  }
  if (
    fileName.length < 1 ||
    fileName.length > SOURCE_FILE_NAME_MAX_LENGTH ||
    FILE_NAME_FORBIDDEN.test(fileName)
  ) {
    return {
      ok: false,
      message: "Rename this file and try again.",
      diagnosticReason: "invalid_file_name",
    };
  }
  return { ok: true, value: { fileName, mimeType, byteSize: file.size } };
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => bytes[index] === byte);
}

function containsAscii(bytes: Uint8Array, text: string): boolean {
  const needle = Array.from(text, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

/** Identifies the actual file type from its bytes; the claimed type is never trusted. */
export function detectSourceMimeType(bytes: Uint8Array): SourceMimeType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && containsAscii(bytes, "word/document.xml")) {
    return DOCX_MIME_TYPE;
  }
  return null;
}

function readClientRequestId(record: Record<string, unknown>): string | null {
  const raw = record.clientRequestId;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  return isValidUuid(trimmed) ? trimmed : null;
}

function rejectUnexpectedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
): ContractValidation<never> | null {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      return {
        ok: false,
        message: `Unexpected field: ${key}.`,
        diagnosticReason: "unexpected_field",
      };
    }
  }
  return null;
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export function validatePrepareSourceDocumentInput(
  body: unknown,
): ContractValidation<PrepareSourceDocumentRequest> {
  const record = asRecord(body);
  if (!record) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
      diagnosticReason: "invalid_payload_shape",
    };
  }
  const unexpected = rejectUnexpectedKeys(record, [
    "fileName",
    "mimeType",
    "byteSize",
    "sha256",
    "clientRequestId",
  ]);
  if (unexpected) {
    return unexpected;
  }
  const clientRequestId = readClientRequestId(record);
  if (!clientRequestId) {
    return {
      ok: false,
      message: "clientRequestId must be a valid UUID.",
      diagnosticReason: "invalid_client_request_id",
    };
  }
  if (typeof record.fileName !== "string" || typeof record.byteSize !== "number") {
    return { ok: false, message: UNSUPPORTED_FILE_MESSAGE, diagnosticReason: "invalid_document_type" };
  }
  const candidate = validateSourceFileCandidate({
    name: record.fileName,
    size: record.byteSize,
  });
  if (!candidate.ok) {
    return candidate;
  }
  if (record.mimeType !== candidate.value.mimeType) {
    return { ok: false, message: UNSUPPORTED_FILE_MESSAGE, diagnosticReason: "invalid_document_type" };
  }
  const sha256 = typeof record.sha256 === "string" ? record.sha256.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    return {
      ok: false,
      message: "sha256 must be a 64-character hex digest.",
      diagnosticReason: "invalid_sha256",
    };
  }
  return { ok: true, value: { ...candidate.value, sha256, clientRequestId } };
}

export function validateCompleteSourceDocumentInput(
  body: unknown,
): ContractValidation<CompleteSourceDocumentRequest> {
  const record = asRecord(body);
  if (!record) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
      diagnosticReason: "invalid_payload_shape",
    };
  }
  const unexpected = rejectUnexpectedKeys(record, ["clientRequestId"]);
  if (unexpected) {
    return unexpected;
  }
  const clientRequestId = readClientRequestId(record);
  if (!clientRequestId) {
    return {
      ok: false,
      message: "clientRequestId must be a valid UUID.",
      diagnosticReason: "invalid_client_request_id",
    };
  }
  return { ok: true, value: { clientRequestId } };
}

export function validateCreateIntentRequestInput(
  body: unknown,
): ContractValidation<CreateIntentRequestRequest> {
  const record = asRecord(body);
  if (!record) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
      diagnosticReason: "invalid_payload_shape",
    };
  }
  const unexpected = rejectUnexpectedKeys(record, ["intentText", "audience", "clientRequestId"]);
  if (unexpected) {
    return unexpected;
  }
  const clientRequestId = readClientRequestId(record);
  if (!clientRequestId) {
    return {
      ok: false,
      message: "clientRequestId must be a valid UUID.",
      diagnosticReason: "invalid_client_request_id",
    };
  }
  if (record.audience !== undefined && record.audience !== null && typeof record.audience !== "string") {
    return { ok: false, message: "Audience must be text.", diagnosticReason: "invalid_audience" };
  }
  const audience = typeof record.audience === "string" ? record.audience.replace(/\s+/g, " ").trim() : "";
  if (audience.length > INTENT_AUDIENCE_MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep who this is for to ${INTENT_AUDIENCE_MAX_LENGTH} characters or fewer.`,
      diagnosticReason: "invalid_audience",
    };
  }
  const intentText = typeof record.intentText === "string" ? record.intentText.trim() : "";
  if (!intentText) {
    return {
      ok: false,
      message: "Tell us what you need to understand.",
      diagnosticReason: "invalid_intent",
    };
  }
  if (intentText.length > INTENT_TEXT_MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep this to ${INTENT_TEXT_MAX_LENGTH} characters or fewer.`,
      diagnosticReason: "invalid_intent",
    };
  }
  return { ok: true, value: { intentText, audience: audience || null, clientRequestId } };
}

export function normalizeSourceDocumentRecord(raw: unknown): SourceDocument | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const id = typeof record.id === "string" ? record.id : "";
  const hiveId = typeof record.hiveId === "string" ? record.hiveId : "";
  const clientRequestId =
    typeof record.clientRequestId === "string" ? record.clientRequestId : "";
  if (!isValidUuid(id) || !isValidUuid(hiveId) || !isValidUuid(clientRequestId)) {
    return null;
  }
  if (
    typeof record.fileName !== "string" ||
    !isSourceMimeType(record.mimeType) ||
    typeof record.byteSize !== "number" ||
    !includes(SOURCE_DOCUMENT_STATUSES, record.status) ||
    !includes(SCAN_STATUSES, record.scanStatus) ||
    !includes(READ_STATUSES, record.readStatus) ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    return null;
  }
  const failureReason = includes(SOURCE_FAILURE_REASONS, record.failureReason)
    ? record.failureReason
    : null;
  return {
    id,
    sourceDocumentId: id,
    hiveId,
    clientRequestId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    status: record.status,
    failureReason,
    scanStatus: record.scanStatus,
    readStatus: record.readStatus,
    registeredAt: typeof record.registeredAt === "string" ? record.registeredAt : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function normalizeUploadQuota(raw: unknown): UploadQuota | null {
  const record = asRecord(raw);
  if (
    !record ||
    typeof record.limit !== "number" ||
    typeof record.used !== "number" ||
    typeof record.remaining !== "number" ||
    typeof record.periodStart !== "string" ||
    typeof record.periodEnd !== "string"
  ) {
    return null;
  }
  return {
    limit: record.limit,
    used: record.used,
    remaining: record.remaining,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
  };
}

export function normalizeIntentRequestRecord(raw: unknown): IntentRequest | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const id = typeof record.id === "string" ? record.id : "";
  const hiveId = typeof record.hiveId === "string" ? record.hiveId : "";
  const clientRequestId =
    typeof record.clientRequestId === "string" ? record.clientRequestId : "";
  if (
    !isValidUuid(id) ||
    !isValidUuid(hiveId) ||
    !isValidUuid(clientRequestId) ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }
  return { id, intentRequestId: id, hiveId, clientRequestId, createdAt: record.createdAt };
}
