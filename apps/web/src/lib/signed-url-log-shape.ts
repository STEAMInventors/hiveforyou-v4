/**
 * Host/path shape for logs — no query string (tokens) or full path payloads.
 */
export type SignedUrlShapeForLog =
  | { kind: "ok"; host: string; scheme: string; pathSegmentCount: number }
  | { kind: "invalid" };

export function signedUrlShapeForLog(url: string): SignedUrlShapeForLog {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return { kind: "invalid" };
    const pathSegmentCount = u.pathname.split("/").filter(Boolean).length;
    return { kind: "ok", host: u.host, scheme: u.protocol === "https:" ? "https" : "http", pathSegmentCount };
  } catch {
    return { kind: "invalid" };
  }
}

export function isHttpOrHttpsUrlString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 10 &&
    (value.startsWith("https://") || value.startsWith("http://"))
  );
}
