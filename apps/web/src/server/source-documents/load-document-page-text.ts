import { createHiveError } from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DocumentPageTextResult = {
  readonly pageText: string;
  readonly extractionMethod: string;
  readonly pageCount: number;
  readonly mimeType: string;
};

function requireUuid(value: string, correlationId: string, message: string, diagnostic: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: message,
      correlationId,
      diagnosticReason: diagnostic,
    });
  }
  return trimmed;
}

/**
 * Hive-owner only (RLS). Returns persisted reader text for quote matching / PDF overlay when present.
 */
export async function loadSourceDocumentAndPageText(
  client: SupabaseClient,
  input: {
    readonly hiveId: string;
    readonly sourceDocumentId: string;
    readonly pageNumber: number;
    readonly correlationId: string;
  },
): Promise<DocumentPageTextResult | null> {
  const hiveId = requireUuid(input.hiveId, input.correlationId, "Invalid Hive identifier.", "invalid_hive_id");
  const sourceDocumentId = requireUuid(
    input.sourceDocumentId,
    input.correlationId,
    "Invalid document identifier.",
    "invalid_source_document_id",
  );
  if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Invalid page number.",
      correlationId: input.correlationId,
      diagnosticReason: "invalid_page_number",
    });
  }

  const { data: doc, error: docErr } = await client
    .schema("hive")
    .from("source_documents")
    .select("id, mime_type")
    .eq("id", sourceDocumentId)
    .eq("case_id", hiveId)
    .maybeSingle();

  if (docErr || !doc) {
    throw createHiveError({
      errorCode: "NOT_FOUND",
      category: "SECURITY",
      stage: "SHELL",
      retryable: false,
      safeMessage: "We could not find that document.",
      correlationId: input.correlationId,
      diagnosticReason: "not_found",
    });
  }

  const mimeType = typeof doc.mime_type === "string" ? doc.mime_type : "application/pdf";

  const { data: pageRow, error: pageErr } = await client
    .schema("hive")
    .from("document_pages")
    .select("page_text, extraction_method, page_count")
    .eq("hive_id", hiveId)
    .eq("source_document_id", sourceDocumentId)
    .eq("page_number", input.pageNumber)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pageErr) {
    throw createHiveError({
      errorCode: "INTERNAL_ERROR",
      category: "PERSISTENCE",
      stage: "READ",
      retryable: false,
      safeMessage: "Could not load document text for this page.",
      correlationId: input.correlationId,
      diagnosticReason: "document_page_query_failed",
    });
  }
  if (!pageRow || typeof pageRow.page_text !== "string") {
    return null;
  }

  const extractionMethod = typeof pageRow.extraction_method === "string" ? pageRow.extraction_method : "";
  const pageCount =
    typeof pageRow.page_count === "number" && Number.isInteger(pageRow.page_count) ? pageRow.page_count : 1;

  return {
    pageText: pageRow.page_text,
    extractionMethod,
    pageCount,
    mimeType,
  };
}
