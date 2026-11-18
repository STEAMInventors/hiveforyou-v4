import { createHiveError } from "@hiveforyou/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveEmailSender } from "@/server/email";
import { renderPracticeAreaRequestEmail } from "@/server/email/practice-area-request-template";
import { loadFirm } from "@/server/firm/load-firm";
import { CORRELATION_HEADER } from "@/server/observability/correlation";
import { emitStructuredEvent } from "@/server/observability/logger";
import { withApiRoute, readJsonBody } from "@/server/observability/with-api-route";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

const BODY_MAX = 2000;

export async function POST(request: NextRequest): Promise<Response> {
  const run = withApiRoute("firm", "practiceAreaRequest", async ({ correlationId, request: req }) => {
    const auth = await requireAuthenticatedUser();
    if (!auth.ok) {
      throw createHiveError({
        errorCode: "UNAUTHENTICATED",
        category: "SECURITY",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Sign in to send a practice area request.",
        correlationId,
        diagnosticReason: auth.diagnosticReason,
      });
    }

    const raw = await readJsonBody(req, correlationId);
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const body = typeof record?.body === "string" ? record.body.replace(/\s+/g, " ").trim() : "";
    if (body.length < 1 || body.length > BODY_MAX) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: `Tell us what you handle in ${BODY_MAX} characters or fewer.`,
        correlationId,
        diagnosticReason: "invalid_body",
      });
    }

    const { data, error } = await auth.client.rpc("submit_practice_area_request", { p_body: body });
    if (error) {
      throw createHiveError({
        errorCode: "INVALID_REQUEST",
        category: "VALIDATION",
        stage: "SHELL",
        retryable: false,
        safeMessage: "Could not save your request. Try again.",
        correlationId,
        diagnosticReason: error.message?.slice(0, 80) ?? "submit_practice_area_request_failed",
      });
    }

    const firm = await loadFirm(auth.client);
    const alertTo = process.env.OWNER_ALERT_EMAIL?.trim();
    if (alertTo) {
      try {
        const firmName = firm?.firm?.name ?? "Unknown firm";
        const requesterEmail = auth.email ?? "unknown";
        const rendered = renderPracticeAreaRequestEmail({ firmName, requesterEmail, body });
        await resolveEmailSender().send({
          to: alertTo,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });
      } catch (cause) {
        emitStructuredEvent({
          eventName: "firm.practice_area_request.email_failed",
          severity: "WARN",
          timestamp: new Date().toISOString(),
          component: "firm",
          operation: "practice_area_request",
          stage: "SHELL",
          correlationId,
          diagnosticReason: cause instanceof Error ? cause.name : "email_failed",
        });
      }
    }

    return NextResponse.json(data ?? { ok: true }, { headers: { [CORRELATION_HEADER]: correlationId } });
  });

  return run(request);
}