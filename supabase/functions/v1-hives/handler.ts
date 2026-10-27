import {
  buildPublicErrorBody,
  CORRELATION_HEADER,
  corsHeaders,
  jsonResponse,
  logEdgeEvent,
  resolveEdgeCorrelationId,
} from "../_shared/http.ts";

const DB_TIMEOUT_MS = 8000;
const HIVE_NAME_MAX_LENGTH = 100;
const HIVE_DESCRIPTION_MAX_LENGTH = 500;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return value.length === 36 && UUID_REGEX.test(value);
}

export type EdgeHivePayload = {
  id: string;
  hiveId: string;
  name: string;
  description: string | null;
  clientRequestId: string;
  createdAt: string;
  updatedAt: string;
};

export type EdgeOperation =
  | { op: "list" }
  | { op: "get"; hiveId: string }
  | { op: "get_by_client_request_id"; clientRequestId: string }
  | {
      op: "create";
      name: string;
      description: string | null;
      clientRequestId: string;
    };

export type EdgeUserSupabaseClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type EdgeErrorPayload = {
  errorCode: string;
  category: string;
  stage: "SHELL";
  message: string;
  retryable: boolean;
  diagnosticReason: string;
  status: number;
};

export function parseEdgeOperation(
  body: unknown,
): { ok: true; operation: EdgeOperation } | { ok: false; error: EdgeErrorPayload } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      error: {
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        message: "Invalid Hive operation.",
        retryable: false,
        diagnosticReason: "invalid_payload_shape",
        status: 422,
      },
    };
  }

  const record = body as Record<string, unknown>;
  const op = record.op;

  if (op === "list") {
    return { ok: true, operation: { op: "list" } };
  }

  if (op === "get") {
    const rawId =
      typeof record.hiveId === "string"
        ? record.hiveId.trim()
        : typeof record.hive_id === "string"
          ? record.hive_id.trim()
          : "";
    if (!isValidUuid(rawId)) {
      return {
        ok: false,
        error: {
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          message: "Invalid Hive identifier.",
          retryable: false,
          diagnosticReason: "invalid_hive_id",
          status: 422,
        },
      };
    }
    return { ok: true, operation: { op: "get", hiveId: rawId.toLowerCase() } };
  }

  if (op === "get_by_client_request_id") {
    const rawReqId =
      typeof record.clientRequestId === "string"
        ? record.clientRequestId.trim()
        : typeof record.client_request_id === "string"
          ? record.client_request_id.trim()
          : "";
    if (!isValidUuid(rawReqId)) {
      return {
        ok: false,
        error: {
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          message: "clientRequestId must be a valid UUID.",
          retryable: false,
          diagnosticReason: "invalid_client_request_id",
          status: 422,
        },
      };
    }
    return {
      ok: true,
      operation: {
        op: "get_by_client_request_id",
        clientRequestId: rawReqId.toLowerCase(),
      },
    };
  }

  if (op === "create") {
    const allowed = new Set([
      "op",
      "name",
      "description",
      "clientRequestId",
      "client_request_id",
    ]);
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        return {
          ok: false,
          error: {
            errorCode: "INVALID_REQUEST",
            category: "VALIDATION",
            stage: "SHELL",
            message: `Unexpected field: ${key}.`,
            retryable: false,
            diagnosticReason: "unexpected_field",
            status: 422,
          },
        };
      }
    }

    const rawReqId =
      typeof record.clientRequestId === "string"
        ? record.clientRequestId.trim()
        : typeof record.client_request_id === "string"
          ? record.client_request_id.trim()
          : "";
    if (!isValidUuid(rawReqId)) {
      return {
        ok: false,
        error: {
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          message: "clientRequestId must be a valid UUID.",
          retryable: false,
          diagnosticReason: "invalid_client_request_id",
          status: 422,
        },
      };
    }

    if (typeof record.name !== "string") {
      return {
        ok: false,
        error: {
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          message: "Hive name is required.",
          retryable: false,
          diagnosticReason: "invalid_name",
          status: 422,
        },
      };
    }

    if (
      record.description !== undefined &&
      record.description !== null &&
      typeof record.description !== "string"
    ) {
      return {
        ok: false,
        error: {
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          message: "Description must be a string.",
          retryable: false,
          diagnosticReason: "invalid_description",
          status: 422,
        },
      };
    }

    const trimmedName = record.name.trim();
    const trimmedDesc =
      typeof record.description === "string" ? record.description.trim() : "";

    if (!trimmedName || trimmedName.length > HIVE_NAME_MAX_LENGTH) {
      return {
        ok: false,
        error: {
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          message: !trimmedName
            ? "Give your Hive a name so you can find it later."
            : `Hive name must be ${HIVE_NAME_MAX_LENGTH} characters or fewer.`,
          retryable: false,
          diagnosticReason: "invalid_name",
          status: 422,
        },
      };
    }

    if (trimmedDesc.length > HIVE_DESCRIPTION_MAX_LENGTH) {
      return {
        ok: false,
        error: {
          errorCode: "INVALID_REQUEST",
          category: "VALIDATION",
          stage: "SHELL",
          message: `Description must be ${HIVE_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
          retryable: false,
          diagnosticReason: "invalid_description",
          status: 422,
        },
      };
    }

    return {
      ok: true,
      operation: {
        op: "create",
        name: trimmedName,
        description: trimmedDesc.length > 0 ? trimmedDesc : null,
        clientRequestId: rawReqId.toLowerCase(),
      },
    };
  }

  return {
    ok: false,
    error: {
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      message: "Unsupported Hive operation.",
      retryable: false,
      diagnosticReason: "unsupported_operation",
      status: 422,
    },
  };
}

function normalizeEdgeHive(raw: unknown): EdgeHivePayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const hiveId = typeof row.hiveId === "string" ? row.hiveId.trim() : id;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const clientRequestId =
    typeof row.clientRequestId === "string"
      ? row.clientRequestId.trim()
      : typeof row.client_request_id === "string"
        ? row.client_request_id.trim()
        : "";
  const createdAt =
    typeof row.createdAt === "string"
      ? row.createdAt
      : typeof row.created_at === "string"
        ? row.created_at
        : "";
  const updatedAt =
    typeof row.updatedAt === "string"
      ? row.updatedAt
      : typeof row.updated_at === "string"
        ? row.updated_at
        : "";

  if (!id || !name || !clientRequestId || !createdAt || !updatedAt) {
    return null;
  }

  const description =
    typeof row.description === "string" && row.description.trim().length > 0
      ? row.description.trim()
      : null;

  return {
    id,
    hiveId,
    name,
    description,
    clientRequestId,
    createdAt,
    updatedAt,
  };
}

async function withTimeout<T>(
  promise: PromiseLike<T>,
  timeoutMs = DB_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function mapRpcFailure(error: unknown): EdgeErrorPayload {
  const record =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown; details?: unknown })
      : {};
  const code = typeof record.code === "string" ? record.code.trim() : "";
  const message =
    typeof record.message === "string"
      ? record.message
      : error instanceof Error
        ? error.message
        : String(error ?? "");
  const lowered = message.toLowerCase();

  if (lowered.includes("auth_required")) {
    return {
      errorCode: "UNAUTHENTICATED",
      category: "SECURITY",
      stage: "SHELL",
      message: "Sign in to continue.",
      retryable: false,
      diagnosticReason: "no_session",
      status: 401,
    };
  }

  if (lowered.includes("idempotency_conflict")) {
    return {
      errorCode: "IDEMPOTENCY_CONFLICT",
      category: "PERSISTENCE",
      stage: "SHELL",
      message:
        "This create request ID was already used with different Hive details.",
      retryable: false,
      diagnosticReason: "idempotency_conflict",
      status: 409,
    };
  }

  if (
    lowered.includes("invalid_request") ||
    code === "22023" ||
    code === "22P02" ||
    code === "23514"
  ) {
    return {
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      message: "Invalid Hive input.",
      retryable: false,
      diagnosticReason: "invalid_request",
      status: 422,
    };
  }

  if (lowered.includes("hive_not_found") || code === "P0002") {
    return {
      errorCode: "NOT_FOUND",
      category: "SECURITY",
      stage: "SHELL",
      message: "We could not find that Hive.",
      retryable: false,
      diagnosticReason: "not_found",
      status: 404,
    };
  }

  if (code === "42501" || lowered.includes("access_denied") || lowered.includes("permission")) {
    return {
      errorCode: "ACCESS_DENIED",
      category: "SECURITY",
      stage: "SHELL",
      message: "You do not have access to this Hive.",
      retryable: false,
      diagnosticReason: "access_denied",
      status: 403,
    };
  }

  if (code === "23505" || lowered.includes("unique") || lowered.includes("duplicate")) {
    return {
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      message: "We could not save your Hive right now. Please try again.",
      retryable: false,
      diagnosticReason: "unique_violation",
      status: 503,
    };
  }

  if (message === "timeout") {
    return {
      errorCode: "PERSISTENCE_FAILED",
      category: "PERSISTENCE",
      stage: "SHELL",
      message:
        "We could not confirm whether your Hive was saved. Try again with the same request.",
      retryable: true,
      diagnosticReason: "timeout",
      status: 503,
    };
  }

  return {
    errorCode: "PERSISTENCE_FAILED",
    category: "PERSISTENCE",
    stage: "SHELL",
    message: "Something went wrong while accessing your Hives. Please try again.",
    retryable: true,
    diagnosticReason: "persistence_failed",
    status: 503,
  };
}

export async function handleV1HivesRequest(
  req: Request,
  createUserClient: (authHeader: string) => EdgeUserSupabaseClient,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const started = Date.now();
  const correlationId = resolveEdgeCorrelationId(
    req.headers.get(CORRELATION_HEADER),
  );
  const authHeader = req.headers.get("Authorization")?.trim() ?? "";

  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    logEdgeEvent({
      eventName: "edgeHives.failed",
      severity: "WARN",
      operation: "edgeHives",
      stage: "SHELL",
      correlationId,
      status: "FAILED",
      errorCode: "UNAUTHENTICATED",
      retryable: false,
      durationMs: Date.now() - started,
      diagnosticReason: "no_session",
    });
    return jsonResponse(
      {
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        message: "Sign in to continue.",
        retryable: false,
        diagnosticReason: "no_session",
      },
      401,
      correlationId,
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(
      {
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        message: "Request body must be valid JSON.",
        retryable: false,
        diagnosticReason: "invalid_json",
      },
      422,
      correlationId,
    );
  }

  const parsed = parseEdgeOperation(rawBody);
  if (!parsed.ok) {
    logEdgeEvent({
      eventName: "edgeHives.failed",
      severity: "INFO",
      operation: "edgeHives",
      stage: "SHELL",
      correlationId,
      status: "FAILED",
      errorCode: parsed.error.errorCode,
      retryable: parsed.error.retryable,
      durationMs: Date.now() - started,
      diagnosticReason: parsed.error.diagnosticReason,
    });
    return jsonResponse(parsed.error, parsed.error.status, correlationId);
  }

  const operation = parsed.operation;

  try {
    const supabase = createUserClient(authHeader);
    const { data: userData, error: userError } = await withTimeout(
      supabase.auth.getUser(),
    );
    if (userError || !userData.user) {
      logEdgeEvent({
        eventName: "edgeHives.failed",
        severity: "WARN",
        operation: operation.op,
        stage: "SHELL",
        correlationId,
        status: "FAILED",
        errorCode: "UNAUTHENTICATED",
        retryable: false,
        durationMs: Date.now() - started,
        diagnosticReason: "no_session",
      });
      return jsonResponse(
        {
          errorCode: "UNAUTHENTICATED",
          category: "SECURITY",
          stage: "SHELL",
          message: "Sign in to continue.",
          retryable: false,
          diagnosticReason: "no_session",
        },
        401,
        correlationId,
      );
    }

    if (operation.op === "list") {
      const { data, error } = await withTimeout(supabase.rpc("list_hives"));
      if (error) {
        throw error;
      }
      const list = Array.isArray(data)
        ? data
            .map((entry) => normalizeEdgeHive(entry))
            .filter((item): item is EdgeHivePayload => item !== null)
        : [];
      logEdgeEvent({
        eventName: "listHives.completed",
        severity: "INFO",
        operation: "listHives",
        stage: "SHELL",
        correlationId,
        status: "SUCCEEDED",
        durationMs: Date.now() - started,
      });
      return jsonResponse({ hives: list }, 200, correlationId);
    }

    if (operation.op === "get") {
      const { data, error } = await withTimeout(
        supabase.rpc("get_hive", { p_hive_id: operation.hiveId }),
      );
      if (error) {
        throw error;
      }
      const hive = normalizeEdgeHive(data);
      if (!hive) {
        logEdgeEvent({
          eventName: "getHive.failed",
          severity: "WARN",
          operation: "getHive",
          stage: "SHELL",
          correlationId,
          hiveId: operation.hiveId,
          status: "FAILED",
          errorCode: "NOT_FOUND",
          retryable: false,
          durationMs: Date.now() - started,
          diagnosticReason: "not_found",
        });
        return jsonResponse(
          buildPublicErrorBody({
            errorCode: "NOT_FOUND",
            category: "SECURITY",
            message: "We could not find that Hive.",
            retryable: false,
            correlationId,
          }),
          404,
          correlationId,
        );
      }
      logEdgeEvent({
        eventName: "getHive.completed",
        severity: "INFO",
        operation: "getHive",
        stage: "SHELL",
        correlationId,
        hiveId: operation.hiveId,
        status: "SUCCEEDED",
        durationMs: Date.now() - started,
      });
      return jsonResponse({ hive }, 200, correlationId);
    }

    if (operation.op === "get_by_client_request_id") {
      const { data, error } = await withTimeout(
        supabase.rpc("get_hive_by_client_request_id", {
          p_client_request_id: operation.clientRequestId,
        }),
      );
      if (error) {
        throw error;
      }
      const hive = normalizeEdgeHive(data);
      logEdgeEvent({
        eventName: "getHiveByClientRequestId.completed",
        severity: "INFO",
        operation: "getHiveByClientRequestId",
        stage: "SHELL",
        correlationId,
        status: "SUCCEEDED",
        durationMs: Date.now() - started,
      });
      return jsonResponse({ hive }, 200, correlationId);
    }

    const { data, error } = await withTimeout(
      supabase.rpc("create_hive", {
        p_name: operation.name,
        p_description: operation.description,
        p_client_request_id: operation.clientRequestId,
      }),
    );
    if (error) {
      throw error;
    }

    const payload =
      data && typeof data === "object"
        ? (data as { hive?: unknown; created?: unknown })
        : {};
    const hive = normalizeEdgeHive(payload.hive ?? data);
    if (!hive) {
      throw new Error("insert_without_row");
    }
    const created = payload.created !== false;

    logEdgeEvent({
      eventName: "createHive.completed",
      severity: "INFO",
      operation: "createHive",
      stage: "SHELL",
      correlationId,
      hiveId: hive.id,
      status: "SUCCEEDED",
      durationMs: Date.now() - started,
    });
    return jsonResponse({ hive, created }, created ? 201 : 200, correlationId);
  } catch (error) {
    const mapped = mapRpcFailure(error);
    logEdgeEvent({
      eventName: "edgeHives.failed",
      severity: mapped.retryable ? "ERROR" : "WARN",
      operation: operation.op,
      stage: "SHELL",
      correlationId,
      status: "FAILED",
      errorCode: mapped.errorCode,
      retryable: mapped.retryable,
      durationMs: Date.now() - started,
      diagnosticReason: mapped.diagnosticReason,
    });
    return jsonResponse(mapped, mapped.status, correlationId);
  }
}
