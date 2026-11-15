import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { resolvePostSignInPath } from "@/lib/auth/post-sign-in";
import { getPublicSupabaseConfig } from "@/lib/supabase-config";
import { logAuthFailure, logAuthInfo } from "@/server/auth/action-support";
import { safeEmailOtpType } from "@/server/auth/callback-intent";
import {
  classifyAuthError,
  linkErrorCodeForKind,
  sanitizeDiagnostic,
  toAuthErrorInput,
} from "@/server/auth/map-auth-error";
import { verifyEmailOtp } from "@/server/auth/otp";
import { safeNextPath } from "@/server/auth/redirects";
import { resolveAppOrigin } from "@/server/config/app-origin";
import {
  CORRELATION_HEADER,
  resolveCorrelationId,
} from "@/server/observability/correlation";

function safeProviderCode(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return sanitizeDiagnostic(normalized) === normalized ? normalized : undefined;
}

function failureRedirect(appOrigin: string, next: string, errorCode: string): URL {
  const destination = new URL("/sign-in", appOrigin);
  destination.searchParams.set("error", errorCode);
  destination.searchParams.set("next", next);
  return destination;
}

export async function GET(request: Request) {
  const { correlationId } = resolveCorrelationId(
    request.headers.get(CORRELATION_HEADER),
  );
  const appOrigin = resolveAppOrigin({ requestUrl: request.url });
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpTypeParam = requestUrl.searchParams.get("type");
  const safeOtpType = safeEmailOtpType(otpTypeParam);
  const nextParam = requestUrl.searchParams.get("next");
  const next = safeNextPath(nextParam, "/hives");
  const providerCode =
    safeProviderCode(requestUrl.searchParams.get("error_code")) ??
    safeProviderCode(requestUrl.searchParams.get("error"));

  const sendFailure = (errorCode: string) => {
    const destination = failureRedirect(appOrigin, next, errorCode);
    const redirect = NextResponse.redirect(destination);
    redirect.headers.set(CORRELATION_HEADER, correlationId);
    return redirect;
  };

  const hasPkceCode = Boolean(code);
  const hasTokenHash = Boolean(tokenHash && safeOtpType);

  if (!hasPkceCode && !hasTokenHash) {
    if (providerCode === "otp_expired") {
      logAuthFailure("authCallback", correlationId, {
        kind: "link_expired",
        message: "otp_expired",
        errorCode: "AUTH_FAILED",
        retryable: false,
        diagnostic: "otp_expired",
      });
      return sendFailure("otp_expired");
    }
    const mapped = classifyAuthError(
      { code: providerCode, status: providerCode ? 400 : undefined },
      "callback",
    );
    const linkCode = providerCode
      ? linkErrorCodeForKind(mapped.kind, providerCode)
      : "link_invalid";
    logAuthFailure("authCallback", correlationId, {
      ...mapped,
      kind: providerCode ? mapped.kind : "link_invalid",
      diagnostic: providerCode ? mapped.diagnostic : "missing_code",
    });
    return sendFailure(linkCode);
  }

  let supabaseUrl: string;
  let anonKey: string;
  try {
    ({ url: supabaseUrl, anonKey } = getPublicSupabaseConfig());
  } catch {
    const mapped = classifyAuthError({ status: 503 }, "callback");
    logAuthFailure("authCallback", correlationId, mapped);
    return sendFailure("link_unavailable");
  }

  const cookieStore = await cookies();
  let response = NextResponse.redirect(new URL("/hives", appOrigin));

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: {
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }[],
      ) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const started = Date.now();
  try {
    if (hasPkceCode && code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      const durationMs = Date.now() - started;
      if (error) {
        const mapped = classifyAuthError(toAuthErrorInput(error), "callback");
        logAuthFailure("authCallback", correlationId, mapped, durationMs);
        return sendFailure(linkErrorCodeForKind(mapped.kind, mapped.diagnostic));
      }
    } else if (tokenHash && safeOtpType) {
      const { error } = await verifyEmailOtp(supabase, {
        token_hash: tokenHash,
        type: safeOtpType,
      });
      const durationMs = Date.now() - started;
      if (error) {
        const mapped = classifyAuthError(toAuthErrorInput(error), "callback");
        logAuthFailure("authCallback", correlationId, mapped, durationMs);
        return sendFailure(linkErrorCodeForKind(mapped.kind, mapped.diagnostic));
      }
    }
  } catch (caught) {
    const mapped = classifyAuthError(toAuthErrorInput(caught), "callback");
    logAuthFailure(
      "authCallback",
      correlationId,
      mapped,
      Date.now() - started,
    );
    return sendFailure(linkErrorCodeForKind(mapped.kind, mapped.diagnostic));
  }

  logAuthInfo("authCallback", correlationId, "session_exchanged", Date.now() - started);

  const destination = await resolvePostSignInPath(supabase, next);
  response = NextResponse.redirect(new URL(destination, appOrigin));
  response.headers.set(CORRELATION_HEADER, correlationId);
  return response;
}