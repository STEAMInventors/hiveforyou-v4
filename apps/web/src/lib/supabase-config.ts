export type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return null;
  }
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const json = atob(padded);
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function assertBrowserSafeSupabaseAnonKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error("Public Supabase anon key is empty.");
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("service_role") || trimmed.startsWith("sb_secret_")) {
    throw new Error(
      "Public Supabase configuration must not use a secret or service-role key.",
    );
  }
  if (trimmed.startsWith("sb_publishable_")) {
    return;
  }
  if (trimmed.startsWith("eyJ")) {
    const payload = decodeJwtPayload(trimmed);
    if (payload?.role === "anon") {
      return;
    }
    throw new Error("Public Supabase JWT key must have role anon.");
  }
  throw new Error(
    "Public Supabase anon key format is not recognized as browser-safe.",
  );
}

export function assertPublicSupabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("Public Supabase URL is not a valid URL.");
  }
  const isLocal =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
    throw new Error("Public Supabase URL must use HTTPS.");
  }
  if (!isLocal && !parsed.hostname.endsWith(".supabase.co")) {
    throw new Error("Public Supabase URL must be a supabase.co project URL.");
  }
}

export function getPublicSupabaseConfig(
  env: Record<string, string | undefined> = process.env,
): PublicSupabaseConfig {
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const rawKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  assertPublicSupabaseUrl(rawUrl);
  assertBrowserSafeSupabaseAnonKey(rawKey);
  return {
    url: rawUrl,
    anonKey: rawKey,
  };
}
