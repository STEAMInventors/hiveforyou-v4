import { basename } from "node:path";
import { HiveError } from "@hives/core";
import type { CorrelationId } from "@hives/contracts";

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".docx",
  ".tif",
  ".tiff",
  ".txt",
] as const;
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  DOCX_MIME_TYPE,
  "image/tiff",
  "text/plain",
] as const;
export const BLOCKED_EXTENSIONS = [
  ".exe",
  ".bat",
  ".cmd",
  ".js",
  ".mjs",
  ".ps1",
  ".sh",
  ".dll",
  ".com",
] as const;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type FileValidationInput = {
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly correlationId: CorrelationId;
  readonly bytes?: Uint8Array | undefined;
};

export function sanitizeFilename(originalName: string): string {
  const base = basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.length > 0 ? base.slice(0, 180) : "unnamed";
}

export function validateUpload(input: FileValidationInput): { readonly safeName: string } {
  const safeName = sanitizeFilename(input.originalName);
  const ext = safeName.includes(".") ? `.${safeName.split(".").pop()?.toLowerCase() ?? ""}` : "";
  if ((BLOCKED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new HiveError({
      code: "EXECUTABLE_UPLOAD_BLOCKED",
      category: "POLICY_ERROR",
      message: "Executable uploads are not permitted.",
      retryable: false,
      severity: "ERROR",
      correlationId: input.correlationId,
    });
  }
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new HiveError({
      code: "EXTENSION_NOT_ALLOWED",
      category: "INPUT_ERROR",
      message: "File extension is not allowed.",
      retryable: false,
      severity: "ERROR",
      correlationId: input.correlationId,
      safeContext: { extension: ext },
    });
  }
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new HiveError({
      code: "MIME_NOT_ALLOWED",
      category: "INPUT_ERROR",
      message: "MIME type is not allowed.",
      retryable: false,
      severity: "ERROR",
      correlationId: input.correlationId,
      safeContext: { mimeType: input.mimeType },
    });
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new HiveError({
      code: "FILE_SIZE_INVALID",
      category: "INPUT_ERROR",
      message: "File size is outside the permitted range.",
      retryable: false,
      severity: "ERROR",
      correlationId: input.correlationId,
    });
  }
  assertMagicBytes(ext, input.bytes, input.correlationId);
  return { safeName };
}

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);
const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const TIFF_LE = new Uint8Array([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BE = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a]);

function startsWith(bytes: Uint8Array, magic: Uint8Array): boolean {
  if (bytes.byteLength < magic.byteLength) {
    return false;
  }
  for (let i = 0; i < magic.byteLength; i += 1) {
    if (bytes[i] !== magic[i]) {
      return false;
    }
  }
  return true;
}

function containsAscii(bytes: Uint8Array, text: string): boolean {
  const needle = Array.from(text, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.byteLength - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return true;
  }
  return false;
}

function assertMagicBytes(
  ext: string,
  bytes: Uint8Array | undefined,
  correlationId: CorrelationId,
): void {
  if (bytes === undefined) {
    return;
  }
  const matches =
    ext === ".pdf"
      ? startsWith(bytes, PDF_MAGIC)
      : ext === ".png"
        ? startsWith(bytes, PNG_MAGIC)
        : ext === ".jpg" || ext === ".jpeg"
          ? startsWith(bytes, JPEG_MAGIC)
          : ext === ".docx"
            ? startsWith(bytes, ZIP_MAGIC) && containsAscii(bytes, "word/document.xml")
            : ext === ".tif" || ext === ".tiff"
              ? startsWith(bytes, TIFF_LE) || startsWith(bytes, TIFF_BE)
              : ext === ".txt"
                ? !bytes.includes(0)
                : true;
  if (!matches) {
    throw new HiveError({
      code: "FILE_CONTENT_MISMATCH",
      category: "INPUT_ERROR",
      message: "File content does not match the declared type.",
      retryable: false,
      severity: "ERROR",
      correlationId,
      safeContext: { extension: ext },
    });
  }
}
