import type { CorrelationId } from "@hives/contracts";
import { HiveError } from "@hives/core";

/**
 * Determines source_documents.page_count from local file structure only.
 * No OCR, no network, no content extraction.
 */
export function determineSourcePageCount(
  mimeType: string,
  bytes: Uint8Array,
  correlationId: CorrelationId,
): number {
  switch (mimeType) {
    case "application/pdf":
      return countPdfPages(bytes, correlationId);
    case "image/png":
    case "image/jpeg":
      return 1;
    case "text/plain":
      // Engine 1 v0.1 treats plain text as a single logical page.
      return 1;
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return countDocxPages(bytes, correlationId);
    case "image/tiff":
      return countTiffFrames(bytes, correlationId);
    default:
      throw pageCountError(
        correlationId,
        "PAGE_COUNT_UNSUPPORTED_TYPE",
        "Source page count cannot be determined for this MIME type.",
        { mimeType },
      );
  }
}

function countPdfPages(bytes: Uint8Array, correlationId: CorrelationId): number {
  if (bytes.byteLength < 5) {
    throw pageCountError(
      correlationId,
      "PAGE_COUNT_UNAVAILABLE",
      "PDF page count could not be determined from the file structure.",
    );
  }
  const latin1 = Buffer.from(bytes).toString("latin1");
  // Strip stream bodies so binary payload cannot invent false /Type /Page markers.
  const withoutStreams = latin1.replace(/stream\r?\n[\s\S]*?endstream/g, "stream\nendstream");
  const pageObjectMatches = withoutStreams.match(/\/Type\s*\/Page(?!\s*s)\b/g);
  const count = pageObjectMatches?.length ?? 0;
  if (count < 1) {
    throw pageCountError(
      correlationId,
      "PAGE_COUNT_UNAVAILABLE",
      "PDF page count could not be determined from the file structure.",
    );
  }
  return count;
}

function countTiffFrames(bytes: Uint8Array, correlationId: CorrelationId): number {
  if (bytes.byteLength < 8) {
    throw pageCountError(
      correlationId,
      "PAGE_COUNT_UNAVAILABLE",
      "TIFF frame count could not be determined from the file structure.",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const b0 = view.getUint8(0);
  const b1 = view.getUint8(1);
  const littleEndian = b0 === 0x49 && b1 === 0x49;
  const bigEndian = b0 === 0x4d && b1 === 0x4d;
  if (!littleEndian && !bigEndian) {
    throw pageCountError(
      correlationId,
      "PAGE_COUNT_UNAVAILABLE",
      "TIFF frame count could not be determined from the file structure.",
    );
  }
  const magic = view.getUint16(2, littleEndian);
  if (magic !== 42) {
    throw pageCountError(
      correlationId,
      "PAGE_COUNT_UNAVAILABLE",
      "TIFF frame count could not be determined from the file structure.",
    );
  }

  let ifdOffset = view.getUint32(4, littleEndian);
  let frames = 0;
  const seen = new Set<number>();
  const maxFrames = 10_000;

  while (ifdOffset !== 0) {
    if (seen.has(ifdOffset) || frames >= maxFrames) {
      throw pageCountError(
        correlationId,
        "PAGE_COUNT_UNAVAILABLE",
        "TIFF frame count could not be determined from the file structure.",
      );
    }
    seen.add(ifdOffset);
    if (ifdOffset + 2 > bytes.byteLength) {
      throw pageCountError(
        correlationId,
        "PAGE_COUNT_UNAVAILABLE",
        "TIFF frame count could not be determined from the file structure.",
      );
    }
    const entryCount = view.getUint16(ifdOffset, littleEndian);
    const nextOffsetPos = ifdOffset + 2 + entryCount * 12;
    if (nextOffsetPos + 4 > bytes.byteLength) {
      throw pageCountError(
        correlationId,
        "PAGE_COUNT_UNAVAILABLE",
        "TIFF frame count could not be determined from the file structure.",
      );
    }
    frames += 1;
    ifdOffset = view.getUint32(nextOffsetPos, littleEndian);
  }

  if (frames < 1) {
    throw pageCountError(
      correlationId,
      "PAGE_COUNT_UNAVAILABLE",
      "TIFF frame count could not be determined from the file structure.",
    );
  }
  return frames;
}

function countDocxPages(bytes: Uint8Array, correlationId: CorrelationId): number {
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw pageCountError(
      correlationId,
      "PAGE_COUNT_UNAVAILABLE",
      "DOCX structure could not be verified from the file header.",
    );
  }
  return 1;
}

function pageCountError(
  correlationId: CorrelationId,
  code: string,
  message: string,
  safeContext?: Readonly<Record<string, string | number | boolean | null>>,
): HiveError {
  return new HiveError({
    code,
    category: "INPUT_ERROR",
    message,
    retryable: false,
    severity: "ERROR",
    correlationId,
    ...(safeContext === undefined ? {} : { safeContext }),
  });
}
