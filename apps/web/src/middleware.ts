import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicSupabaseConfig } from "@/lib/supabase-config";
import { fetchMyProfile } from "@/lib/auth/profile";
import { safeNextPath } from "@/server/auth/redirects";
import {
  CORRELATION_HEADER,
  resolveCorrelationId,
} from "@/server/observability/correlation";

const PROTECTED_PREFIXES = ["/hives", "/welcome"];

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

function signInUrl(request: NextRequest, nextPath: string, start?: string | null): URL {
  const destination = new URL("/sign-in", request.url);
  destination.searchParams.set("next", nextPath);
  if (start) {
    destination.searchParams.set("start", start);
  }
  return destination;
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
  let supabaseClient: ReturnType<typeof createServerClient> | null = null;
  try {
    const { url: supabaseUrl, anonKey: supabaseAnonKey } =
      getPublicSupabaseConfig();

    supabaseClient = createServerClient(supabaseUrl, supabaseAnonKey, {
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

    const { data } = await supabaseClient.auth.getUser();
    signedIn = Boolean(data.user);
  } catch {
    signedIn = false;
  }

  const { pathname, search } = request.nextUrl;
  const nextPath = `${pathname}${search}`;
  const start = request.nextUrl.searchParams.get("start");

  if (isProtectedPath(pathname) && !signedIn) {
    const redirect = NextResponse.redirect(signInUrl(request, nextPath, start));
    redirect.headers.set(CORRELATION_HEADER, correlationId);
    return redirect;
  }

  if (pathname === "/sign-in" && signedIn && supabaseClient) {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"), "/hives");
    const { profile, error: profileError } = await fetchMyProfile(supabaseClient);
    if (!profileError && !profile) {
      return redirectTo(request, `/welcome?next=${encodeURIComponent(next)}`, correlationId);
    }
    return redirectTo(request, profile ? next : "/hives", correlationId);
  }

  if (pathname === "/welcome" && signedIn && supabaseClient) {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"), "/hives");
    const { profile, error: profileError } = await fetchMyProfile(supabaseClient);
    if (!profileError && profile) {
      return redirectTo(request, next, correlationId);
    }
  }

  if (
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/sign-in"
  ) {
    const next = request.nextUrl.searchParams.get("next");
    if (next && (!next.startsWith("/") || next.startsWith("//"))) {
      const cleaned = new URL(pathname, request.url);
      cleaned.searchParams.set("next", safeNextPath(null, "/hives"));
      for (const key of ["start", "error"] as const) {
        const value = request.nextUrl.searchParams.get(key);
        if (value) cleaned.searchParams.set(key, value);
      }
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