import { createHiveError, isValidUuid } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fetchMyProfile } from "@/lib/auth/profile";
import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { withApiRoute } from "@/server/observability/with-api-route";
import { loadFirm } from "@/server/firm/load-firm";
import { firmInviteSubject, renderFirmInviteEmail } from "@/server/email/invitation-templates";
import { resolveEmailSender } from "@/server/email";
import { generateInviteToken } from "@/server/hives/invite-token";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_SEND_FAILED = "We couldn't send the invitation. Try again.";

function resolvePublicBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

function createdMemberId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const firmMemberId = (data as { firmMemberId?: unknown }).firmMemberId;
  if (typeof firmMemberId !== "string" || !isValidUuid(firmMemberId)) return null;
  return firmMemberId.trim().toLowerCase();
}

export async function POST(request: NextRequest): Promise<Response> {
  const run = withApiRoute("firm", "inviteFirmMember", async ({ correlationId }) => {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to invite someone.",
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
    const title = typeof record?.title === "string" ? record.title.trim() : "";
    const role = typeof record?.role === "string" ? record.role.trim().toLowerCase() : "member";
    if (!EMAIL_RE.test(email)) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: `Check the email “${typeof record?.email === "string" ? record.email.trim() : ""}”.`,
        correlationId,
        diagnosticReason: "invalid_email",
      });
    }
    if (title.length < 1 || title.length > 40 || (role !== "member" && role !== "attorney")) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Enter a title up to 40 characters.",
        correlationId,
        diagnosticReason: "invalid_title",
      });
    }

    const firm = await loadFirm(auth.client);
    const { profile } = await fetchMyProfile(auth.client);
    const ownerName = profile?.displayName?.trim() || "Your colleague";
    const firmName = firm?.firm?.name?.trim() || "the firm";
    const { token, tokenHash } = generateInviteToken();
    const { data, error } = await auth.client.rpc("invite_firm_member", {
      p_email: email,
      p_title: title,
      p_role: role,
      p_token_hash: tokenHash,
    });
    if (error) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Could not invite that person. Try again.",
        correlationId,
        diagnosticReason: error.message?.slice(0, 80) ?? "invite_firm_member_failed",
      });
    }

    const inviteUrl = `${resolvePublicBaseUrl(request)}/firm-invite/${token}`;
    const subject = firmInviteSubject(ownerName, firmName);
    const { text, html } = renderFirmInviteEmail({ ownerName, firmName, inviteUrl });
    try {
      await resolveEmailSender().send({
        to: email,
        subject,
        text,
        html,
        fromDisplay: "HiveForYou",
      });
    } catch (sendError) {
      const firmMemberId = createdMemberId(data);
      if (firmMemberId) {
        try {
          await auth.client.rpc("revoke_firm_invitation", { p_firm_member_id: firmMemberId });
        } catch {
          // The response stays the send failure.
        }
      }
      throw createHiveError({
        errorCode: "INTERNAL_ERROR",
        category: "INTERNAL",
        stage: "SHELL",
        retryable: true,
        safeMessage: INVITE_SEND_FAILED,
        correlationId,
        diagnosticReason: "firm_invitation_email_failed",
        cause: sendError,
      });
    }

    return NextResponse.json({ ok: true, invitation: data }, {
      status: 201,
      headers: { [CORRELATION_HEADER]: correlationId },
    });
  });
  return run(request);
}
