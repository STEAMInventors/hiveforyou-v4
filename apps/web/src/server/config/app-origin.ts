export const CANONICAL_APP_ORIGIN = "https://hiveforyou-v4.vercel.app";

export function isTrustedAppHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (host === "hiveforyou-v4.vercel.app") {
    return true;
  }
  if (host === "localhost" || host === "127.0.0.1") {
    return true;
  }
  if (/^hiveforyou-v4-[a-z0-9-]+\.vercel\.app$/.test(host)) {
    return true;
  }
  return false;
}

function protocolForHostname(hostname: string): "http" | "https" {
  return hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https";
}

export function resolveAppOriginFromHost(
  hostHeader: string | null | undefined,
): string | null {
  if (!hostHeader?.trim()) {
    return null;
  }
  const host = hostHeader.split(",")[0]?.trim();
  if (!host) {
    return null;
  }
  const hostname = host.includes(":") ? host.slice(0, host.indexOf(":")) : host;
  if (!isTrustedAppHostname(hostname)) {
    return null;
  }
  const protocol = protocolForHostname(hostname);
  return `${protocol}://${host}`;
}

export function resolveAppOriginFromRequestUrl(requestUrl: string): string | null {
  try {
    const url = new URL(requestUrl);
    if (!isTrustedAppHostname(url.hostname)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function resolveFromVercelUrl(): string | null {
  const raw = process.env.VERCEL_URL?.trim();
  if (!raw) {
    return null;
  }
  const hostname =
    raw
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .split("/")[0] ?? "";
  if (!hostname || !isTrustedAppHostname(hostname)) {
    return null;
  }
  return `https://${hostname}`;
}

export type ResolveAppOriginInput = {
  requestUrl?: string;
  hostHeader?: string | null;
};

export function resolveAppOrigin(input: ResolveAppOriginInput = {}): string {
  if (input.requestUrl) {
    const fromRequest = resolveAppOriginFromRequestUrl(input.requestUrl);
    if (fromRequest) {
      return fromRequest;
    }
  }
  const fromHost = resolveAppOriginFromHost(input.hostHeader);
  if (fromHost) {
    return fromHost;
  }
  const fromVercel = resolveFromVercelUrl();
  if (fromVercel) {
    return fromVercel;
  }
  return CANONICAL_APP_ORIGIN;
}
