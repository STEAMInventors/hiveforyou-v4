import { safeNextPath } from "./redirects";

export const AUTH_CALLBACK_PATH = "/auth/callback";

/**
 * Redirect target for password-reset emails. Uses `type=recovery` (not `next=`) so Supabase
 * allow-list entries can match `…/auth/callback?type=recovery` or a V3 wildcard pattern.
 */
export function passwordRecoveryEmailRedirectTo(appOrigin: string): string {
  const url = new URL(AUTH_CALLBACK_PATH, appOrigin);
  url.searchParams.set("type", "recovery");
  return url.toString();
}

/** Redirect target for signup confirmation and resend flows. */
export function authEmailRedirectTo(appOrigin: string, nextPath: string): string {
  const url = new URL(AUTH_CALLBACK_PATH, appOrigin);
  url.searchParams.set("next", safeNextPath(nextPath, "/hives"));
  return url.toString();
}
