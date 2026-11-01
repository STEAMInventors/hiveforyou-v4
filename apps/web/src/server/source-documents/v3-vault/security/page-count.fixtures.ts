/** Local structural fixtures for page-count and registration tests. No OCR. */

/** Minimal PDF whose /Type /Page objects match `pageCount`. */
export function structuredPdf(pageCount: number, marker = ""): Uint8Array {
  const header = `%PDF-1.4\n${marker.length > 0 ? `% ${marker}\n` : ""}`;
  const objects: string[] = [];
  const kids = Array.from({ length: pageCount }, (_, index) => `${3 + index} 0 R`).join(" ");
  objects.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  objects.push(`2 0 obj<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>endobj\n`);
  for (let index = 0; index < pageCount; index += 1) {
    objects.push(
      `${3 + index} 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>endobj\n`,
    );
  }
  let body = header;
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }
  const xrefStart = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export function pngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
    0x00, 0x05, 0xfe, 0x02, 0xfe, 0xa3, 0x2f, 0x15, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

export function jpegBytes(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

/** Little-endian TIFF with `frameCount` IFDs (pages/frames). */
export function structuredTiff(frameCount: number): Uint8Array {
  const headerSize = 8;
  const ifdSize = 2 + 12 + 4;
  const total = headerSize + frameCount * ifdSize;
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 0x49);
  view.setUint8(1, 0x49);
  view.setUint16(2, 42, true);
  let offset = headerSize;
  view.setUint32(4, offset, true);
  for (let index = 0; index < frameCount; index += 1) {
    view.setUint16(offset, 1, true);
    view.setUint16(offset + 2, 256, true);
    view.setUint16(offset + 4, 3, true);
    view.setUint32(offset + 6, 1, true);
    view.setUint32(offset + 10, 1, true);
    const next = index === frameCount - 1 ? 0 : offset + ifdSize;
    view.setUint32(offset + 14, next, true);
    offset += ifdSize;
  }
  return bytes;
}
