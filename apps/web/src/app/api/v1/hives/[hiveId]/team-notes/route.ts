import { createHiveError, isValidUuid } from "@hiveforyou/contracts";

const IDEMPOTENCY_HEADER = "idempotency-key";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = { params: Promise<{ hiveId: string }> };

const NOTE_MAX = 2000;

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "listTeamNotes", async ({ correlationId }) => {
    const { hiveId } = await context.params;
    if (!hiveId || !isValidUuid(hiveId.trim())) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid Hive identifier.",
        correlationId,
        diagnosticReason: "invalid_hive_id",
      });
    }

    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to view team notes.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const { data, error } = await auth.client.rpc("list_team_notes", {
      p_hive_id: hiveId.trim().toLowerCase(),
    });
    if (error) {
      throw createHiveError({
        errorCode: "ACCESS_DENIED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Could not load team notes.",
        correlationId,
        diagnosticReason: "list_team_notes_failed",
      });
    }

    return NextResponse.json(data, { headers: { [CORRELATION_HEADER]: correlationId } });
  });
  return run(_request);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "addTeamNote", async ({ correlationId }) => {
    const { hiveId } = await context.params;
    if (!hiveId || !isValidUuid(hiveId.trim())) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid Hive identifier.",
        correlationId,
        diagnosticReason: "invalid_hive_id",
      });
    }

    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to add a team note.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Request body must be valid JSON.",
        correlationId,
        diagnosticReason: "invalid_json",
      });
    }

    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const body = typeof record?.body === "string" ? record.body.trim() : "";
    const itemRef = typeof record?.itemRef === "string" ? record.itemRef.trim().slice(0, 120) : "";
    if (body.length < 1 || body.length > NOTE_MAX) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Enter a note up to 2000 characters.",
        correlationId,
        diagnosticReason: "invalid_note_body",
      });
    }

    const idempotencyRaw = request.headers.get(IDEMPOTENCY_HEADER)?.trim().toLowerCase() ?? "";
    const clientRequestId =
      idempotencyRaw && isValidUuid(idempotencyRaw)
        ? idempotencyRaw
        : typeof record?.clientRequestId === "string" && isValidUuid(record.clientRequestId.trim())
          ? record.clientRequestId.trim().toLowerCase()
          : null;

    const { data, error } = await auth.client.rpc("add_team_note", {
      p_hive_id: hiveId.trim().toLowerCase(),
      p_body: body,
      p_item_ref: itemRef || null,
      p_client_request_id: clientRequestId,
    });
    if (error) {
      throw createHiveError({
        errorCode: "ACCESS_DENIED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Could not save the note.",
        correlationId,
        diagnosticReason: "add_team_note_failed",
      });
    }

    return NextResponse.json(data, { headers: { [CORRELATION_HEADER]: correlationId } });
  });
  return run(request);
}