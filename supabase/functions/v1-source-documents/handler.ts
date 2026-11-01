import {
  buildPublicErrorBody,
  CORRELATION_HEADER,
  corsHeaders,
  jsonResponse,
  logEdgeEvent,
  resolveEdgeCorrelationId,
} from "../_shared/http.ts";

const DB_TIMEOUT_MS = 8000;
const SOURCE_BUCKET = "hive-source-documents";

export type SourceDocumentsOperation =
  | { op: "list"; hiveId: string }
  | {
      op: "prepare";
      hiveId: string;
      fileName: string;
      mimeType: string;
      byteSize: number;
      sha256: string;
      clientRequestId: string;
    }
  | { op: "complete"; hiveId: string; clientRequestId: string };

type SupabaseClientLike = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  storage: {
    from: (bucket: string) => {
      createSignedUploadUrl: (
        path: string,
        expiresIn: number,
      ) => PromiseLike<{
        data: { path: string; token: string } | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function parseSourceDocumentsOperation(
  body: unknown,
): { ok: true; operation: SourceDocumentsOperation } | { ok: false; status: number; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 422, message: "Invalid source document operation." };
  }
  const record = body as Record<string, unknown>;
  const op = record.op;
  if (op === "list") {
    const hiveId = typeof record.hiveId === "string" ? record.hiveId.trim().toLowerCase() : "";
    if (!isValidUuid(hiveId)) {
      return { ok: false, status: 422, message: "Invalid Hive identifier." };
    }
    return { ok: true, operation: { op: "list", hiveId } };
  }
  if (op === "prepare") {
    const hiveId = typeof record.hiveId === "string" ? record.hiveId.trim().toLowerCase() : "";
    const clientRequestId =
      typeof record.clientRequestId === "string" ? record.clientRequestId.trim().toLowerCase() : "";
    const fileName = typeof record.fileName === "string" ? record.fileName.trim() : "";
    const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
    const byteSize = typeof record.byteSize === "number" ? record.byteSize : -1;
    const sha256 = typeof record.sha256 === "string" ? record.sha256.trim().toLowerCase() : "";
    if (
      !isValidUuid(hiveId) ||
      !isValidUuid(clientRequestId) ||
      !fileName ||
      !mimeType ||
      byteSize < 1 ||
      !/^[0-9a-f]{64}$/.test(sha256)
    ) {
      return { ok: false, status: 422, message: "Invalid prepare payload." };
    }
    return {
      ok: true,
      operation: { op: "prepare", hiveId, fileName, mimeType, byteSize, sha256, clientRequestId },
    };
  }
  if (op === "complete") {
    const hiveId = typeof record.hiveId === "string" ? record.hiveId.trim().toLowerCase() : "";
    const clientRequestId =
      typeof record.clientRequestId === "string" ? record.clientRequestId.trim().toLowerCase() : "";
    if (!isValidUuid(hiveId) || !isValidUuid(clientRequestId)) {
      return { ok: false, status: 422, message: "Invalid complete payload." };
    }
    return { ok: true, operation: { op: "complete", hiveId, clientRequestId } };
  }
  return { ok: false, status: 422, message: "Unknown source document operation." };
}

export async function handleV1SourceDocumentsRequest(
  request: Request,
  createUserClient: (authHeader: string) => SupabaseClientLike,
  createServiceClient: () => SupabaseClientLike,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const correlationId = resolveEdgeCorrelationId(request.headers.get(CORRELATION_HEADER));
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse(
      401,
      buildPublicErrorBody({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        message: "Sign in to continue.",
        retryable: false,
        diagnosticReason: "no_session",
        correlationId,
      }),
      correlationId,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      422,
      buildPublicErrorBody({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        message: "Request body must be JSON.",
        retryable: false,
        diagnosticReason: "invalid_payload_shape",
        correlationId,
      }),
      correlationId,
    );
  }

  const parsed = parseSourceDocumentsOperation(body);
  if (!parsed.ok) {
    return jsonResponse(
      parsed.status,
      buildPublicErrorBody({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        message: parsed.message,
        retryable: false,
        diagnosticReason: "invalid_payload_shape",
        correlationId,
      }),
      correlationId,
    );
  }

  const userClient = createUserClient(authHeader);
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) {
    return jsonResponse(
      401,
      buildPublicErrorBody({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        message: "Sign in to continue.",
        retryable: false,
        diagnosticReason: "no_session",
        correlationId,
      }),
      correlationId,
    );
  }

  const operation = parsed.operation;
  logEdgeEvent({
    eventName: "sourceDocuments.request",
    correlationId,
    operation: operation.op,
    hiveId: operation.hiveId,
  });

  if (operation.op === "list") {
    const { data, error } = await withTimeout(
      userClient.rpc("list_hive_source_documents", { p_hive_id: operation.hiveId }),
    );
    if (error) {
      return persistenceFailed(correlationId, error.message ?? "list_failed");
    }
    return jsonResponse(200, data ?? { sourceDocuments: [] }, correlationId);
  }

  if (operation.op === "prepare") {
    const existing = await userClient.rpc("get_source_upload_by_client_request", {
      p_hive_id: operation.hiveId,
      p_client_request_id: operation.clientRequestId,
    });
    if (existing.error) {
      return persistenceFailed(correlationId, existing.error.message ?? "prepare_failed");
    }
    const serviceClient = createServiceClient();
    if (existing.data && typeof existing.data === "object") {
      const row = existing.data as { status?: string; storagePath?: string };
      if (row.status === "REGISTERED" || row.status === "FAILED") {
        return jsonResponse(
          200,
          { sourceDocument: existing.data, upload: null, created: false },
          correlationId,
        );
      }
      if (typeof row.storagePath === "string") {
        const signed = await serviceClient.storage
          .from(SOURCE_BUCKET)
          .createSignedUploadUrl(row.storagePath, 3600);
        if (signed.error || !signed.data) {
          return persistenceFailed(correlationId, signed.error?.message ?? "signed_url_failed");
        }
        return jsonResponse(
          200,
          {
            sourceDocument: existing.data,
            upload: { path: signed.data.path, token: signed.data.token },
            created: false,
          },
          correlationId,
        );
      }
    }
    return jsonResponse(
      501,
      buildPublicErrorBody({
        errorCode: "INTERNAL_ERROR",
        category: "PERSISTENCE",
        stage: "REGISTER",
        message: "Prepare is not available on this Edge revision; use the web API route.",
        retryable: false,
        diagnosticReason: "edge_prepare_deferred",
        correlationId,
      }),
      correlationId,
    );
  }

  return jsonResponse(
    501,
    buildPublicErrorBody({
      errorCode: "INTERNAL_ERROR",
      category: "PERSISTENCE",
      stage: "REGISTER",
      message: "Complete is not available on this Edge revision; use the web API route.",
      retryable: false,
      diagnosticReason: "edge_complete_deferred",
      correlationId,
    }),
    correlationId,
  );
}

function persistenceFailed(correlationId: string, diagnosticReason: string): Response {
  return jsonResponse(
    503,
    buildPublicErrorBody({
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      message: "Something went wrong with your documents. Please try again.",
      retryable: true,
      diagnosticReason,
      correlationId,
    }),
    correlationId,
  );
}

async function withTimeout<T>(promise: PromiseLike<T>): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]);
}
