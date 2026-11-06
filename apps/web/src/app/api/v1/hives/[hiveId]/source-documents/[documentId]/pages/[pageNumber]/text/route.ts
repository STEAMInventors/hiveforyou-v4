import { createHiveError } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { loadSourceDocumentAndPageText } from "@/server/source-documents/load-document-page-text";
import { requireApiSupabaseClient } from "@/server/supabase/server-client";

type RouteContext = {
  params: Promise<{ hiveId: string; documentId: string; pageNumber: string }>;
};

/** Reader-persisted page text for quote matching (Hive owner only). */
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("sourceDocuments", "documentPageText", async ({ correlationId }) => {
    const { hiveId, documentId, pageNumber: pageRaw } = await context.params;
    const client = await requireApiSupabaseClient(correlationId, "Sign in to load document text.");
    const trimmed = pageRaw.trim();
    const pageNumber = /^[1-9][0-9]{0,4}$/.test(trimmed) ? Number(trimmed) : null;
    if (pageNumber === null) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid page number.",
        correlationId,
        diagnosticReason: "invalid_page_number",
      });
    }
    const row = await loadSourceDocumentAndPageText(client, {
      hiveId,
      sourceDocumentId: documentId,
      pageNumber,
      correlationId,
    });
    if (!row) {
      throw createHiveError({
        errorCode: "NOT_FOUND",
        category: "DOCUMENT",
        stage: "READ",
        retryable: false,
        safeMessage: "No saved text for this page yet.",
        correlationId,
        diagnosticReason: "document_page_not_found",
      });
    }
    return Response.json(
      {
        pageNumber,
        pageCount: row.pageCount,
        extractionMethod: row.extractionMethod,
        mimeType: row.mimeType,
        pageText: row.pageText,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store", [CORRELATION_HEADER]: correlationId },
      },
    );
  });
  return run(request);
}
