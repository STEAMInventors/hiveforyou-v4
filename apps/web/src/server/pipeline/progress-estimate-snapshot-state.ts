import type { PageTextSlice, SnapshotDocument } from "@hiveforyou/contracts";

import {
  type DocumentPageRpcClient,
  listDocumentPagesForSource,
} from "@/server/source-documents/document-pages-persistence";
import { extractedDocumentIds, savedRangeKeysByDocument } from "@/server/workflow/v5-pipeline-stages";

function parsePayload(data: unknown): Record<string, unknown> | null {
  const payload = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
}

export type ProgressEstimateRpcClient = Pick<DocumentPageRpcClient, "rpc">;

export async function loadProgressEstimateSnapshotState(
  client: ProgressEstimateRpcClient,
  input: {
    readonly hiveId: string;
    readonly runId: string;
    readonly correlationId: string;
    readonly documents: readonly SnapshotDocument[];
    readonly fallbackExtractedDocumentCount: number;
  },
): Promise<{
  pagesByDocument: Map<string, readonly PageTextSlice[]>;
  savedRangeKeysByDocument: Map<string, ReadonlySet<string>>;
  extractedDocumentIds: Set<string>;
}> {
  const pagesByDocument = new Map<string, readonly PageTextSlice[]>();
  const digestByDocument = new Map(
    input.documents.map((doc) => [doc.sourceDocumentId.toLowerCase(), doc.pageSetDigest.toLowerCase()]),
  );

  let sourcePagesLoaded = false;
  try {
    const { data, error } = await client.rpc("get_study_source_pages", { p_run_id: input.runId });
    const payload = !error ? parsePayload(data) : null;
    if (payload && Array.isArray(payload.pages)) {
      const grouped = new Map<string, Map<number, string>>();
      for (const raw of payload.pages as Record<string, unknown>[]) {
        const docId = typeof raw.sourceDocumentId === "string" ? raw.sourceDocumentId.toLowerCase() : "";
        const pageNumber = Number(raw.pageNumber);
        const text = typeof raw.pageText === "string" ? raw.pageText : "";
        if (!docId || !Number.isInteger(pageNumber) || pageNumber <= 0) continue;
        const docPages = grouped.get(docId) ?? new Map<number, string>();
        docPages.set(pageNumber, text);
        grouped.set(docId, docPages);
      }
      for (const document of input.documents) {
        const docId = document.sourceDocumentId.toLowerCase();
        const textByPage = grouped.get(docId);
        pagesByDocument.set(
          docId,
          Array.from({ length: document.verifiedPageCount }, (_, index) => {
            const pageNumber = index + 1;
            return { pageNumber, text: textByPage?.get(pageNumber) ?? "" };
          }),
        );
      }
      sourcePagesLoaded = true;
    }
  } catch {
    sourcePagesLoaded = false;
  }

  if (!sourcePagesLoaded) {
    await Promise.all(
      input.documents.map(async (document) => {
        const docId = document.sourceDocumentId.toLowerCase();
        try {
          const listed = await listDocumentPagesForSource(client, {
            hiveId: input.hiveId,
            sourceDocumentId: document.sourceDocumentId,
            readFingerprint: document.readFingerprint,
            pageSetDigest: document.pageSetDigest,
            expectedSourceSha256: document.sha256,
            correlationId: input.correlationId,
          });
          const textByPage = new Map(listed.pages.map((page) => [page.page_number, page.page_text]));
          pagesByDocument.set(
            docId,
            Array.from({ length: document.verifiedPageCount }, (_, index) => {
              const pageNumber = index + 1;
              return { pageNumber, text: textByPage.get(pageNumber) ?? "" };
            }),
          );
        } catch {
          pagesByDocument.set(
            docId,
            Array.from({ length: document.verifiedPageCount }, (_, index) => ({
              pageNumber: index + 1,
              text: "",
            })),
          );
        }
      }),
    );
  }

  let savedRanges = new Map<string, ReadonlySet<string>>();
  try {
    const { data, error } = await client.rpc("get_doc_extraction_ranges_for_run", {
      p_processing_run_id: input.runId,
    });
    const payload = !error ? parsePayload(data) : null;
    if (payload && Array.isArray(payload.ranges)) {
      const filtered = (payload.ranges as Record<string, unknown>[]).filter((row) => {
        const docId = typeof row.sourceDocumentId === "string" ? row.sourceDocumentId.toLowerCase() : "";
        const expectedDigest = digestByDocument.get(docId);
        if (!expectedDigest) return false;
        const rowDigest = typeof row.contentDigest === "string" ? row.contentDigest.toLowerCase() : null;
        return rowDigest === null || rowDigest === expectedDigest;
      });
      savedRanges = savedRangeKeysByDocument({ ranges: filtered });
    }
  } catch {
    savedRanges = new Map();
  }

  let extractedIds: Set<string> | null = null;
  try {
    const { data, error } = await client.rpc("get_doc_extractions_for_run", {
      p_processing_run_id: input.runId,
    });
    const payload = !error ? parsePayload(data) : null;
    if (payload && Array.isArray(payload.extractions)) {
      const filtered = (payload.extractions as Record<string, unknown>[]).filter((row) => {
        const docId = typeof row.sourceDocumentId === "string" ? row.sourceDocumentId.toLowerCase() : "";
        const expectedDigest = digestByDocument.get(docId);
        if (!expectedDigest) return false;
        const rowDigest = typeof row.contentDigest === "string" ? row.contentDigest.toLowerCase() : null;
        return rowDigest === null || rowDigest === expectedDigest;
      });
      extractedIds = extractedDocumentIds({ extractions: filtered });
    }
  } catch {
    extractedIds = null;
  }

  if (!extractedIds) {
    extractedIds = new Set(
      input.documents
        .slice(0, input.fallbackExtractedDocumentCount)
        .map((document) => document.sourceDocumentId.toLowerCase()),
    );
  }

  return {
    pagesByDocument,
    savedRangeKeysByDocument: savedRanges,
    extractedDocumentIds: extractedIds,
  };
}
