import {
  createHiveError,
  HIVE_NAME_MAX_LENGTH,
  HIVE_DESCRIPTION_MAX_LENGTH,
  isValidUuid,
  SOMETHING_ELSE_PACK_ID,
  suggestedHttpStatus,
} from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchMyProfile } from "@/lib/auth/profile";
import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute, readJsonBody } from "@/server/observability/with-api-route";
import { runNewClientFlow, type NewClientFlowInput } from "@/server/hives/new-client-service";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

const IDEMPOTENCY_HEADER = "idempotency-key";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolvePublicBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

function parseBody(raw: unknown, correlationId: string): NewClientFlowInput {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const name = typeof record?.name === "string" ? record.name.trim() : "";
  const email = typeof record?.email === "string" ? record.email.trim().toLowerCase() : undefined;
  const note = typeof record?.note === "string" ? record.note.trim() : undefined;
  const packRaw = record?.packId;
  const packId =
    packRaw === null || packRaw === undefined || packRaw === SOMETHING_ELSE_PACK_ID
      ? null
      : typeof packRaw === "string"
        ? packRaw.trim()
        : null;
  const mode = record?.mode === "documents" ? "documents" : record?.mode === "invite" ? "invite" : null;
  const items = Array.isArray(record?.items)
    ? record!.items
        .map((row) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return null;
          const item = row as Record<string, unknown>;
          if (typeof item.key !== "string" || typeof item.title !== "string") return null;
          return {
            key: item.key.trim(),
            title: item.title.trim(),
            custom: item.custom === true,
          };
        })
        .filter((row): row is NewClientFlowInput["items"][number] => row !== null && row.title !== "")
    : [];

  if (!name || name.length > HIVE_NAME_MAX_LENGTH) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Enter the client's name.",
      correlationId,
      diagnosticReason: "invalid_name",
    });
  }
  if (note && note.length > HIVE_DESCRIPTION_MAX_LENGTH) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: `Description must be ${HIVE_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
      correlationId,
      diagnosticReason: "description_too_long",
    });
  }
  if (!mode) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Invalid request.",
      correlationId,
      diagnosticReason: "invalid_mode",
    });
  }
  if (mode === "invite" && (!email || !EMAIL_RE.test(email))) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Enter a valid email address.",
      correlationId,
      diagnosticReason: "invalid_email",
    });
  }
  if (packId && items.filter((item) => !item.custom).length < 1 && items.length < 1) {
    throw createHiveError({
      errorCode: "INVALID_REQUEST",
      category: "VALIDATION",
      stage: "SHELL",
      retryable: false,
      safeMessage: "Tick at least one item, or choose Something else.",
      correlationId,
      diagnosticReason: "no_checklist_items",
    });
  }
  return {
    name,
    email,
    note: note || undefined,
    packId,
    items,
    mode,
    clientRequestId: "",
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  const run = withApiRoute("hives", "newClient", async ({ correlationId, request: req }) => {
    const idempotencyKey = req.headers.get(IDEMPOTENCY_HEADER)?.trim().toLowerCase();
    if (!idempotencyKey || !isValidUuid(idempotencyKey)) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Missing idempotency key.",
        correlationId,
        diagnosticReason: "missing_idempotency_key",
      });
    }

    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to start a client hive.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const raw = await readJsonBody(req, correlationId);
    const parsed = parseBody(raw, correlationId);
    parsed.clientRequestId = idempotencyKey;

    const { profile } = await fetchMyProfile(auth.client);
    const inviterName = profile?.displayName?.trim() || "Your contact";

    const result = await runNewClientFlow(auth.client, parsed, {
      correlationId,
      inviterName,
      inviteBaseUrl: resolvePublicBaseUrl(req),
    });

    if (result.ok) {
      return NextResponse.json(
        {
          ok: true,
          hiveId: result.hiveId,
          mode: result.mode,
          requestedItemCount: result.requestedItemCount,
        },
        { status: 201, headers: { [CORRELATION_HEADER]: correlationId } },
      );
    }

    if (!result.hiveId) {
      return NextResponse.json(
        { error: result.error },
        {
          status: suggestedHttpStatus(result.error.errorCode),
          headers: { [CORRELATION_HEADER]: correlationId },
        },
      );
    }

    const body = {
      error: result.error,
      hiveId: result.hiveId,
      completed: result.completed,
      failedStep: result.failedStep,
    };
    return NextResponse.json(body, {
      status: suggestedHttpStatus(result.error.errorCode),
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(request);
}