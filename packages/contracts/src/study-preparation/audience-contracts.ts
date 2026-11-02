/**
 * Audience Intelligence (D-041): who the Customer report is for and which professional the Pro report
 * serves. The intent stage proposes `audienceAnalysis` from the person's own words and the provisional
 * glossary; the intent intelligence stage may refine it from document context. Trusted code derives the
 * authoritative `hive.audience-configuration/1` used by planning, the Canonical Study and the Writer.
 *
 * A role is only `STATED` or `INFERRED` when an exact quotation from the person supports it. Document
 * context can make a Customer role at most `PROVISIONAL`: a document that mentions a parent does not
 * prove the person asking is that parent.
 */

export const AUDIENCE_CONFIGURATION_SCHEMA = "hive.audience-configuration/1";

export const AUDIENCE_ROLE_STATUSES = ["STATED", "INFERRED", "PROVISIONAL", "UNKNOWN"] as const;
export type AudienceRoleStatus = (typeof AUDIENCE_ROLE_STATUSES)[number];

export const AUDIENCE_BASIS_KINDS = [
  "STATED_AUDIENCE",
  "REQUEST_WORDING",
  "GLOSSARY",
  "DOCUMENT_CONTEXT",
  "NONE",
] as const;
export type AudienceBasisKind = (typeof AUDIENCE_BASIS_KINDS)[number];

export const AUDIENCE_DETAIL_LEVELS = ["PLAIN", "STANDARD", "DETAILED", "TECHNICAL"] as const;
export type AudienceDetailLevel = (typeof AUDIENCE_DETAIL_LEVELS)[number];

export const AUDIENCE_CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type AudienceConfidence = (typeof AUDIENCE_CONFIDENCE_LEVELS)[number];

export type AudiencePageRef = { sourceDocumentId: string; pageNumber: number };

export type AudienceBasis = {
  kind: AudienceBasisKind;
  /** Exact quotation from the request (`REQUEST_WORDING`) or the stated audience (`STATED_AUDIENCE`). */
  statedAs: string | null;
  intentRequestId: string | null;
  /** Sampled pages behind a `DOCUMENT_CONTEXT` basis. */
  contextRefs: AudiencePageRef[];
};

export type CustomerAudience = {
  role: string | null;
  status: AudienceRoleStatus;
  confidence: AudienceConfidence;
  basis: AudienceBasis;
  tone: string;
  detailLevel: AudienceDetailLevel;
};

export type ProAudience = {
  primaryRole: string | null;
  alternativeRoles: string[];
  status: AudienceRoleStatus;
  confidence: AudienceConfidence;
  basis: AudienceBasis;
  tone: string;
  detailLevel: AudienceDetailLevel;
};

export type AudienceAnalysis = {
  customer: CustomerAudience;
  pro: ProAudience;
  studyGuidance: string[];
  writerGuidance: { customer: string[]; pro: string[] };
};

export type AudienceChange = {
  audience: "customer" | "pro";
  change: string;
  reason: string;
  contextRefs: AudiencePageRef[];
};

export type AudienceConfiguration = AudienceAnalysis & {
  schema: typeof AUDIENCE_CONFIGURATION_SCHEMA;
  /** Where the configuration came from; `FALLBACK` for artifacts saved before audiences existed. */
  source: "INTENT_INTELLIGENCE" | "INTENT_ANALYSIS" | "FALLBACK";
};

export type AudienceIntent = { id: string; intentText: string; audience?: string | null };

export type AudienceParseContext = {
  readonly intents: readonly AudienceIntent[];
  /** `INTENT` may not use document context; `INTELLIGENCE` may, within `allowedRefs`. */
  readonly stage: "INTENT" | "INTELLIGENCE";
  readonly allowedRefs?: ReadonlySet<string>;
};

export type AudienceParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnosticReason: string; message: string };

const ROLE_MAX = 120;
const TONE_MAX = 200;
const GUIDANCE_MAX = 400;
const GUIDANCE_ITEMS = 8;
const ALTERNATIVE_ROLES = 4;

class AudienceError extends Error {
  constructor(readonly diagnosticReason: string, message: string) {
    super(message);
  }
}

function fail(reason: string, message: string): never {
  throw new AudienceError(reason, message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_shape", `${path} must be an object.`);
  return value as Record<string, unknown>;
}

function text(source: Record<string, unknown>, key: string, path: string, max: number): string {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    fail("invalid_text", `${path}.${key} must be non-empty text up to ${max} characters.`);
  }
  return value.trim();
}

function nullableText(source: Record<string, unknown>, key: string, path: string, max: number): string | null {
  const value = source[key];
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "string" || value.length > max) fail("invalid_text", `${path}.${key} must be text or null.`);
  return value.trim();
}

function oneOf<T extends string>(source: Record<string, unknown>, key: string, path: string, allowed: readonly T[]): T {
  const value = source[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail("invalid_enum", `${path}.${key} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function textList(source: Record<string, unknown>, key: string, path: string, maxItems: number, maxLength: number): string[] {
  const value = source[key] ?? [];
  if (!Array.isArray(value) || value.length > maxItems) fail("invalid_shape", `${path}.${key} must be a short list.`);
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0 || item.length > maxLength) {
      fail("invalid_text", `${path}.${key}[${index}] must be short non-empty text.`);
    }
    return item.trim();
  });
}

export function audienceRefKey(ref: AudiencePageRef): string {
  return `${ref.sourceDocumentId.toLowerCase()}#${ref.pageNumber}`;
}

function refs(source: Record<string, unknown>, path: string, allowed: ReadonlySet<string> | undefined): AudiencePageRef[] {
  const value = source.contextRefs ?? [];
  if (!Array.isArray(value) || value.length > 12) fail("invalid_shape", `${path}.contextRefs must be a short list.`);
  return value.map((item, index) => {
    const ref = record(item, `${path}.contextRefs[${index}]`);
    const sourceDocumentId = typeof ref.sourceDocumentId === "string" ? ref.sourceDocumentId.trim().toLowerCase() : "";
    const pageNumber = ref.pageNumber;
    if (typeof pageNumber !== "number" || !Number.isInteger(pageNumber) || pageNumber < 1) {
      fail("evidence_ref_invalid", `${path}.contextRefs[${index}] has an invalid page number.`);
    }
    if (!allowed || !allowed.has(audienceRefKey({ sourceDocumentId, pageNumber }))) {
      fail("evidence_ref_invalid", `${path}.contextRefs[${index}] refers to a page that was not provided.`);
    }
    return { sourceDocumentId, pageNumber };
  });
}

function readBasis(raw: unknown, path: string, context: AudienceParseContext): AudienceBasis {
  const source = record(raw, path);
  const kind = oneOf(source, "kind", path, AUDIENCE_BASIS_KINDS);
  const statedAs = nullableText(source, "statedAs", path, 400);
  const intentRequestIdRaw = nullableText(source, "intentRequestId", path, 64);
  const intentRequestId = intentRequestIdRaw ? intentRequestIdRaw.toLowerCase() : null;

  if (kind === "DOCUMENT_CONTEXT" && context.stage === "INTENT") {
    fail("audience_basis_invalid", `${path}: the request stage cannot rely on document context.`);
  }
  const contextRefs = kind === "DOCUMENT_CONTEXT" ? refs(source, path, context.allowedRefs) : [];
  if (kind === "DOCUMENT_CONTEXT" && contextRefs.length === 0) {
    fail("evidence_ref_missing", `${path}: a document-context basis needs at least one sampled page.`);
  }

  if (kind === "STATED_AUDIENCE" || kind === "REQUEST_WORDING") {
    const intent = context.intents.find((candidate) => candidate.id.toLowerCase() === intentRequestId);
    if (!intent) fail("intent_ref_invalid", `${path}.intentRequestId must refer to a stored request.`);
    const quoted = kind === "STATED_AUDIENCE" ? (intent.audience ?? "") : intent.intentText;
    if (!statedAs || !quoted.includes(statedAs)) {
      fail("quotation_mismatch", `${path}.statedAs must be an exact substring of the person's words.`);
    }
  }
  return {
    kind,
    statedAs: kind === "STATED_AUDIENCE" || kind === "REQUEST_WORDING" ? statedAs : null,
    intentRequestId: kind === "STATED_AUDIENCE" || kind === "REQUEST_WORDING" ? intentRequestId : null,
    contextRefs,
  };
}

/** Status rules shared by both audiences: claims about the person need the person's own words. */
function checkStatus(
  status: AudienceRoleStatus,
  role: string | null,
  basis: AudienceBasis,
  confidence: AudienceConfidence,
  path: string,
  audience: "customer" | "pro",
): void {
  if (status === "UNKNOWN") {
    if (role !== null) fail("audience_role_invalid", `${path}: an unknown role must be null.`);
    return;
  }
  if (role === null) fail("audience_role_invalid", `${path}: a ${status} role needs a role.`);
  const quoted = basis.kind === "STATED_AUDIENCE" || basis.kind === "REQUEST_WORDING";
  if (status === "STATED" && !quoted) {
    fail("audience_unsupported", `${path}: a stated role must quote the person.`);
  }
  if (status === "INFERRED" && audience === "customer" && basis.kind !== "REQUEST_WORDING" && basis.kind !== "STATED_AUDIENCE") {
    fail("audience_unsupported", `${path}: an inferred customer role must quote the request.`);
  }
  if (status === "PROVISIONAL" && confidence === "HIGH") {
    fail("audience_confidence_invalid", `${path}: a provisional role cannot have high confidence.`);
  }
  if (basis.kind === "NONE") {
    fail("audience_unsupported", `${path}: a role without a basis must be unknown.`);
  }
}

function readCustomer(raw: unknown, context: AudienceParseContext): CustomerAudience {
  const path = "audience.customer";
  const source = record(raw, path);
  const role = nullableText(source, "role", path, ROLE_MAX);
  const status = oneOf(source, "status", path, AUDIENCE_ROLE_STATUSES);
  const confidence = oneOf(source, "confidence", path, AUDIENCE_CONFIDENCE_LEVELS);
  const basis = readBasis(source.basis, `${path}.basis`, context);
  checkStatus(status, role, basis, confidence, path, "customer");
  if (basis.kind === "DOCUMENT_CONTEXT" && status !== "PROVISIONAL") {
    fail("audience_unsupported", `${path}: document context can make a customer role provisional only.`);
  }
  return {
    role,
    status,
    confidence,
    basis,
    tone: text(source, "tone", path, TONE_MAX),
    detailLevel: oneOf(source, "detailLevel", path, AUDIENCE_DETAIL_LEVELS),
  };
}

function readPro(raw: unknown, context: AudienceParseContext): ProAudience {
  const path = "audience.pro";
  const source = record(raw, path);
  const primaryRole = nullableText(source, "primaryRole", path, ROLE_MAX);
  const status = oneOf(source, "status", path, AUDIENCE_ROLE_STATUSES);
  const confidence = oneOf(source, "confidence", path, AUDIENCE_CONFIDENCE_LEVELS);
  const basis = readBasis(source.basis, `${path}.basis`, context);
  checkStatus(status, primaryRole, basis, confidence, path, "pro");
  const alternativeRoles = textList(source, "alternativeRoles", path, ALTERNATIVE_ROLES, ROLE_MAX);
  if (primaryRole && alternativeRoles.some((role) => role.toLowerCase() === primaryRole.toLowerCase())) {
    fail("duplicate_id", `${path}.alternativeRoles must not repeat the primary role.`);
  }
  return {
    primaryRole,
    alternativeRoles,
    status,
    confidence,
    basis,
    tone: text(source, "tone", path, TONE_MAX),
    detailLevel: oneOf(source, "detailLevel", path, AUDIENCE_DETAIL_LEVELS),
  };
}

function run<T>(parse: () => T): AudienceParseResult<T> {
  try {
    return { ok: true, value: parse() };
  } catch (error) {
    if (error instanceof AudienceError) {
      return { ok: false, diagnosticReason: error.diagnosticReason, message: error.message };
    }
    throw error;
  }
}

export function parseAudienceAnalysis(raw: unknown, context: AudienceParseContext): AudienceParseResult<AudienceAnalysis> {
  return run(() => {
    const source = record(raw, "audience");
    const writer = record(source.writerGuidance, "audience.writerGuidance");
    return {
      customer: readCustomer(source.customer, context),
      pro: readPro(source.pro, context),
      studyGuidance: textList(source, "studyGuidance", "audience", GUIDANCE_ITEMS, GUIDANCE_MAX),
      writerGuidance: {
        customer: textList(writer, "customer", "audience.writerGuidance", GUIDANCE_ITEMS, GUIDANCE_MAX),
        pro: textList(writer, "pro", "audience.writerGuidance", GUIDANCE_ITEMS, GUIDANCE_MAX),
      },
    };
  });
}

export function parseAudienceChanges(raw: unknown, allowedRefs: ReadonlySet<string>): AudienceParseResult<AudienceChange[]> {
  return run(() => {
    const value = raw ?? [];
    if (!Array.isArray(value) || value.length > 8) fail("invalid_shape", "audienceChanges must be a short list.");
    return value.map((item, index) => {
      const path = `audienceChanges[${index}]`;
      const source = record(item, path);
      return {
        audience: oneOf(source, "audience", path, ["customer", "pro"] as const),
        change: text(source, "change", path, GUIDANCE_MAX),
        reason: text(source, "reason", path, GUIDANCE_MAX),
        contextRefs: refs({ contextRefs: source.contextRefs ?? [] }, path, allowedRefs),
      };
    });
  });
}

const FALLBACK_ANALYSIS: AudienceAnalysis = {
  customer: {
    role: null,
    status: "UNKNOWN",
    confidence: "LOW",
    basis: { kind: "NONE", statedAs: null, intentRequestId: null, contextRefs: [] },
    tone: "Plain, calm and practical.",
    detailLevel: "PLAIN",
  },
  pro: {
    primaryRole: null,
    alternativeRoles: [],
    status: "UNKNOWN",
    confidence: "LOW",
    basis: { kind: "NONE", statedAs: null, intentRequestId: null, contextRefs: [] },
    tone: "Precise, evidence-first and neutral.",
    detailLevel: "TECHNICAL",
  },
  studyGuidance: [],
  writerGuidance: { customer: [], pro: [] },
};

/**
 * The authoritative configuration downstream: the refined intelligence-stage audience when present,
 * else the intent-stage proposal, else a labelled fallback (artifacts saved before D-041).
 */
export function resolveAudienceConfiguration(input: {
  readonly analysis?: { audienceAnalysis?: AudienceAnalysis | null } | null;
  readonly intelligence?: { audience?: AudienceAnalysis | null } | null;
}): AudienceConfiguration {
  if (input.intelligence?.audience) {
    return { schema: AUDIENCE_CONFIGURATION_SCHEMA, source: "INTENT_INTELLIGENCE", ...input.intelligence.audience };
  }
  if (input.analysis?.audienceAnalysis) {
    return { schema: AUDIENCE_CONFIGURATION_SCHEMA, source: "INTENT_ANALYSIS", ...input.analysis.audienceAnalysis };
  }
  return { schema: AUDIENCE_CONFIGURATION_SCHEMA, source: "FALLBACK", ...FALLBACK_ANALYSIS };
}

/** Display label for a role that may be unknown. */
export function audienceRoleLabel(audience: "CUSTOMER" | "PRO", configuration: AudienceConfiguration): string {
  if (audience === "CUSTOMER") return configuration.customer.role ?? "The person who asked";
  return configuration.pro.primaryRole ?? "A relevant professional";
}
