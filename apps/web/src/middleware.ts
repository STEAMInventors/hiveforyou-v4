import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseConfig } from "@/lib/supabase-config";
import {
  ACCOUNT_PASSWORD_PATH,
  FORGOT_PASSWORD_PATH,
  RECOVERY_COOKIE_NAME,
  RESET_PASSWORD_PATH,
  isRecoveryCookieValue,
  recoveryCookieIsSecure,
  recoveryCookieOptions,
} from "@/server/auth/recovery";
import { safeNextPath } from "@/server/auth/redirects";
import {
  CORRELATION_HEADER,
  resolveCorrelationId,
} from "@/server/observability/correlation";

const PROTECTED_PREFIXES = ["/hives", "/account"];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function redirectTo(
  request: NextRequest,
  pathname: string,
  correlationId: string,
  status?: number,
): NextResponse {
  const response = NextResponse.redirect(new URL(pathname, request.url), status);
  response.headers.set(CORRELATION_HEADER, correlationId);
  return response;
}

export async function middleware(request: NextRequest) {
  const { correlationId } = resolveCorrelationId(
    request.headers.get(CORRELATION_HEADER),
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);
  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(CORRELATION_HEADER, correlationId);

  let signedIn = false;
  try {
    const { url: supabaseUrl, anonKey: supabaseAnonKey } =
      getPublicSupabaseConfig();

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({
            request: { headers: requestHeaders },
          });
          response.headers.set(CORRELATION_HEADER, correlationId);
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  } catch {
    signedIn = false;
  }

  const { pathname, search } = request.nextUrl;
  const recoveryPending = isRecoveryCookieValue(
    request.cookies.get(RECOVERY_COOKIE_NAME)?.value,
  );

  if (pathname === RESET_PASSWORD_PATH && !signedIn) {
    const redirect = redirectTo(
      request,
      `${FORGOT_PASSWORD_PATH}?error=link_invalid`,
      correlationId,
    );
    redirect.cookies.set(
      RECOVERY_COOKIE_NAME,
      "",
      recoveryCookieOptions(recoveryCookieIsSecure(), 0),
    );
    return redirect;
  }

  if (recoveryPending && signedIn && !pathname.startsWith("/api/")) {
    const allowed =
      pathname === RESET_PASSWORD_PATH ||
      pathname === FORGOT_PASSWORD_PATH ||
      pathname === "/auth/callback";
    if (!allowed) {
      return redirectTo(request, RESET_PASSWORD_PATH, correlationId);
    }
  }

  if (pathname === FORGOT_PASSWORD_PATH && signedIn && !recoveryPending) {
    return redirectTo(request, ACCOUNT_PASSWORD_PATH, correlationId);
  }

  if (isProtectedPath(pathname) && !signedIn) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(login);
    redirect.headers.set(CORRELATION_HEADER, correlationId);
    return redirect;
  }

  if ((pathname === "/login" || pathname === "/register") && signedIn) {
    return redirectTo(
      request,
      recoveryPending ? RESET_PASSWORD_PATH : "/hives",
      correlationId,
    );
  }

  if (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === FORGOT_PASSWORD_PATH
  ) {
    const next = request.nextUrl.searchParams.get("next");
    if (next && (!next.startsWith("/") || next.startsWith("//"))) {
      const cleaned = new URL(pathname, request.url);
      cleaned.searchParams.set("next", safeNextPath(null, "/hives"));
      const redirect = NextResponse.redirect(cleaned);
      redirect.headers.set(CORRELATION_HEADER, correlationId);
      return redirect;
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
