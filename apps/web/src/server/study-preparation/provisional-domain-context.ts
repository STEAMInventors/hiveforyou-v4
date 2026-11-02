/**
 * Optional provisional domain label and glossary for the first intent-analysis stage. Generic and
 * caller-supplied; no fixed domain registry.
 */

export type ProvisionalDomainContext = {
  readonly label: string;
  readonly glossary: string | null;
};

export type ProvisionalDomainContextInput = {
  readonly label?: string | null;
  readonly glossary?: string | null;
};

export function normalizeProvisionalDomainContext(
  input?: ProvisionalDomainContextInput | null,
): ProvisionalDomainContext {
  const label = typeof input?.label === "string" && input.label.trim().length > 0 ? input.label.trim() : "Unknown";
  const glossary =
    typeof input?.glossary === "string" && input.glossary.trim().length > 0 ? input.glossary.trim() : null;
  return { label, glossary };
}

export function parseProvisionalDomainContextFromInputs(payload: Record<string, unknown>): ProvisionalDomainContext {
  const raw = payload.provisionalDomainContext;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return normalizeProvisionalDomainContext(null);
  }
  const record = raw as Record<string, unknown>;
  return normalizeProvisionalDomainContext({
    label: typeof record.label === "string" ? record.label : null,
    glossary: typeof record.glossary === "string" ? record.glossary : null,
  });
}

export function applyProvisionalDomainToIntentSystemPrompt(
  systemPrompt: string,
  context: ProvisionalDomainContext,
): string {
  const glossaryText = context.glossary ?? "(No glossary supplied.)";
  return systemPrompt
    .replace(/\{\{DOMAIN_LABEL_OR_UNKNOWN\}\}/g, context.label)
    .replace(/\{\{DOMAIN_GLOSSARY\}\}/g, glossaryText);
}
