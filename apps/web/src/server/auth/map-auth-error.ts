import {
  authLogLevel,
  type MappedAuthError,
} from "@/lib/auth/map-auth-error";

export * from "@/lib/auth/map-auth-error";

export function authLogSeverity(mapped: MappedAuthError): "INFO" | "WARN" {
  return authLogLevel(mapped) === "warn" ? "WARN" : "INFO";
}