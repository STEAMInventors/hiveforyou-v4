import { safeNextPath } from "./redirects";

export const AUTH_CALLBACK_PATH = "/auth/callback";

export function authEmailRedirectTo(appOrigin: string, nextPath: string): string {
  const url = new URL(AUTH_CALLBACK_PATH, appOrigin);
  url.searchParams.set("next", safeNextPath(nextPath, "/hives"));
  return url.toString();
}