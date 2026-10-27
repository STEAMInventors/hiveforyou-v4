import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getPublicSupabaseConfig } from "@/lib/supabase-config";
import { logAuthFailure, logAuthInfo } from "@/server/auth/action-support";
import {
  callbackRecoveryIntent,
  callbackSuccessPath,
  safeEmailOtpType,
} from "@/server/auth/callback-intent";
import {
  classifyAuthError,
  linkErrorCodeForKind,
  sanitizeDiagnostic,
  toAuthErrorInput,
} from "@/server/auth/map-auth-error";
import { verifyEmailOtp } from "@/server/auth/otp";
import {
  RECOVERY_COOKIE_NAME,
  recoveryCookieIsSecure,
  recoveryCookieOptions,
} from "@/server/auth/recovery";
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

function attachRecoveryCookie(response: NextResponse): void {
  response.cookies.set(
    RECOVERY_COOKIE_NAME,
    "1",
    recoveryCookieOptions(recoveryCookieIsSecure()),
  );
}

function failureRedirect(
  appOrigin: string,
  next: string,
  errorCode: string,
  recoveryIntent: boolean,
): URL {
  const destination = new URL(
    recoveryIntent ? "/forgot-password" : "/login",
    appOrigin,
  );
  destination.searchParams.set("error", errorCode);
  if (!recoveryIntent) {
    destination.searchParams.set("next", next);
  }
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
  const recoveryIntent = callbackRecoveryIntent({
    next: nextParam,
    type: otpTypeParam,
  });
  const providerCode =
    safeProviderCode(requestUrl.searchParams.get("error_code")) ??
    safeProviderCode(requestUrl.searchParams.get("error"));

  const sendFailure = (errorCode: string) => {
    const destination = failureRedirect(
      appOrigin,
      next,
      errorCode,
      recoveryIntent,
    );
    const redirect = NextResponse.redirect(destination);
    redirect.headers.set(CORRELATION_HEADER, correlationId);
    return redirect;
  };

  const hasPkceCode = Boolean(code);
  const hasTokenHash = Boolean(tokenHash && safeOtpType);

  if (!hasPkceCode && !hasTokenHash) {
    const mapped = classifyAuthError(
      { code: providerCode, status: providerCode ? 400 : undefined },
      "callback",
    );
    const linkCode = providerCode
      ? linkErrorCodeForKind(mapped.kind)
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
  const successPath = callbackSuccessPath(recoveryIntent, nextParam);
  const response = NextResponse.redirect(new URL(successPath, appOrigin));
  response.headers.set(CORRELATION_HEADER, correlationId);

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
        return sendFailure(linkErrorCodeForKind(mapped.kind));
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
        return sendFailure(linkErrorCodeForKind(mapped.kind));
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
    return sendFailure(linkErrorCodeForKind(mapped.kind));
  }

  logAuthInfo(
    "authCallback",
    correlationId,
    recoveryIntent ? "recovery_session" : "session_exchanged",
    Date.now() - started,
  );

  if (recoveryIntent) {
    attachRecoveryCookie(response);
    cookieStore.set(
      RECOVERY_COOKIE_NAME,
      "1",
      recoveryCookieOptions(recoveryCookieIsSecure()),
    );
  }

  return response;
}
