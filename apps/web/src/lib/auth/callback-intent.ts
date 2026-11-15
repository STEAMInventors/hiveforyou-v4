import { safeNextPath } from "./redirects";

export function callbackSuccessPath(next: string | null): string {
  return safeNextPath(next, "/hives");
}