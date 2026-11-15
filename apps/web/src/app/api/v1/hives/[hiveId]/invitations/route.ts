import { createHiveError, isValidUuid, type HiveInvitationRole } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { generateInviteToken } from "@/server/hives/invite-token";
import { sendInvitationEmail } from "@/server/hives/send-invitation-email";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type RouteContext = { params: Promise<{ hiveId: string }> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolvePublicBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host) {
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const run = withApiRoute("hives", "createInvitation", async ({ correlationId }) => {
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
        safeMessage: "Sign in to send an invitation.",
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
    const email = typeof record?.email === "string" ? record.email.trim().toLowerCase() : "";
    const roleRaw = typeof record?.role === "string" ? record.role.trim().toLowerCase() : "";
    const inviterName = typeof record?.inviterName === "string" ? record.inviterName.trim() : "";
    const hiveName = typeof record?.hiveName === "string" ? record.hiveName.trim() : "";
    const requestedItemCount =
      typeof record?.requestedItemCount === "number" && record.requestedItemCount >= 0
        ? Math.floor(record.requestedItemCount)
        : 0;

    if (!EMAIL_RE.test(email)) {
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

    if (roleRaw !== "client" && roleRaw !== "professional") {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Invalid invitation role.",
        correlationId,
        diagnosticReason: "invalid_role",
      });
    }

    const role = roleRaw as HiveInvitationRole;
    const { token, tokenHash } = generateInviteToken();

    const { data, error } = await auth.client.rpc("create_invitation", {
      p_hive_id: hiveId.trim().toLowerCase(),
      p_email: email,
      p_role: role,
      p_token_hash: tokenHash,
    });

    if (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : "";
      const lowered = message.toLowerCase();
      if (lowered.includes("access_denied")) {
        throw createHiveError({
          errorCode: "ACCESS_DENIED",
          category: "SECURITY",
          stage: "SHELL",
          retryable: false,
          safeMessage: "Only the hive owner can send invitations.",
          correlationId,
          diagnosticReason: "access_denied",
        });
      }
      throw createHiveError({
        errorCode: "PERSISTENCE_FAILED",
        category: "PERSISTENCE",
        stage: "SHELL",
        retryable: true,
        safeMessage: "Could not create this invitation. Try again.",
        correlationId,
        diagnosticReason: "persistence_failed",
      });
    }

    const baseUrl = resolvePublicBaseUrl(request);
    const inviteUrl = `${baseUrl}/invite/${token}`;
    await sendInvitationEmail({
      role,
      toEmail: email,
      inviteUrl,
      ownerOrProfessionalName: inviterName || "Your contact",
      hiveName: hiveName || "Hive",
      requestedItemCount: role === "client" ? requestedItemCount : undefined,
    });

    return NextResponse.json({ ok: true, invitation: data }, {
      status: 201,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });

  return run(request);
}