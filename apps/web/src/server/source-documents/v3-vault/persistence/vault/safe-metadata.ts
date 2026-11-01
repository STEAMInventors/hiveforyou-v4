import { sanitizeSafeContext } from "@hives/core";
import type { SafeMetadata } from "./records.js";

const FORBIDDEN_AUDIT_KEYS =
  /^(content|snippet|prompt|response|body|text|bytes|filename|originalFilename|original|document|ssn|email|password|secret|token)$/i;

export function toSafeAuditMetadata(
  metadata: Readonly<Record<string, unknown>>,
): SafeMetadata {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_AUDIT_KEYS.test(key)) {
      continue;
    }
    filtered[key] = value;
  }
  return sanitizeSafeContext(filtered) ?? {};
}
