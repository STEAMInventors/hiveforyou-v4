/**
 * Audience Intelligence (D-041): who the Customer report is for and which professional the Pro report
 * serves. The intent stage proposes `audienceAnalysis` from the person's own words and the provisional
 * glossary; the intent intelligence stage may refine it from document context. Trusted code derives the
 * authoritative `hive.audience-configuration/1` used by planning, the Canonical Study and the Writer.
 *
 * Structural validation only: schema shape, enums, bounds and sampled page refs. Role/status semantics
 * are normalized when inconsistent so plausible model interpretations do not fail the Analyze workflow.
 * Strict quotation and evidence rules apply to goals, study findings and report claims — not audience roles.
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
  /** Quotation the model associated with the basis; not verified as an exact substring here. */
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
  | { ok: false; diagnosticReason: string; message: string; diagnosticField?: string };

const ROLE_MAX = 120;
const TONE_MAX = 200;
const GUIDANCE_MAX = 400;
const GUIDANCE_ITEMS = 8;
const ALTERNATIVE_ROLES = 4;

class AudienceError extends Error {
  constructor(
    readonly diagnosticReason: string,
    message: string,
    readonly diagnosticField?: string,
  ) {
    super(message);
  }
}

/** Safe log field derived from validator paths (no role text or quotations). */
export function audienceDiagnosticField(message: string): string | undefined {
  const match = /^([\w[\].]+):/.exec(message);
  return match?.[1];
}

function fail(reason: string, message: string): never {
  throw new AudienceError(reason, message, audienceDiagnosticField(message));
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

const NONE_BASIS: AudienceBasis = { kind: "NONE", statedAs: null, intentRequestId: null, contextRefs: [] };

function glossaryBasis(): AudienceBasis {
  return { kind: "GLOSSARY", statedAs: null, intentRequestId: null, contextRefs: [] };
}

function readBasis(raw: unknown, path: string, context: AudienceParseContext): AudienceBasis {
  const source = record(raw, path);
  let kind = oneOf(source, "kind", path, AUDIENCE_BASIS_KINDS);
  let statedAs = nullableText(source, "statedAs", path, 400);
  const intentRequestIdRaw = nullableText(source, "intentRequestId", path, 64);
  let intentRequestId = intentRequestIdRaw ? intentRequestIdRaw.toLowerCase() : null;

  if (kind === "DOCUMENT_CONTEXT" && context.stage === "INTENT") {
    fail("audience_basis_invalid", `${path}: the request stage cannot rely on document context.`);
  }
  const contextRefs = kind === "DOCUMENT_CONTEXT" ? refs(source, path, context.allowedRefs) : [];
  if (kind === "DOCUMENT_CONTEXT" && contextRefs.length === 0) {
    fail("evidence_ref_missing", `${path}: a document-context basis needs at least one sampled page.`);
  }

  if (kind === "STATED_AUDIENCE" || kind === "REQUEST_WORDING") {
    const intent = intentRequestId ? context.intents.find((candidate) => candidate.id.toLowerCase() === intentRequestId) : undefined;
    if (!intent) {
      kind = "GLOSSARY";
      statedAs = null;
      intentRequestId = null;
    }
  }

  if (kind === "STATED_AUDIENCE" || kind === "REQUEST_WORDING") {
    return {
      kind,
      statedAs,
      intentRequestId,
      contextRefs: [],
    };
  }
  if (kind === "DOCUMENT_CONTEXT") {
    return { kind, statedAs: null, intentRequestId: null, contextRefs };
  }
  if (kind === "GLOSSARY") {
    return glossaryBasis();
  }
  return NONE_BASIS;
}

function clampConfidence(status: AudienceRoleStatus, confidence: AudienceConfidence): AudienceConfidence {
  if (status === "PROVISIONAL" && confidence === "HIGH") return "MEDIUM";
  if (status === "UNKNOWN") return "LOW";
  return confidence;
}

function normalizeCustomerAudience(
  input: Omit<CustomerAudience, "tone" | "detailLevel">,
  stage: AudienceParseContext["stage"],
): Pick<CustomerAudience, "role" | "status" | "confidence" | "basis"> {
  let { role, status, confidence, basis } = input;

  if (status === "UNKNOWN") {
    role = null;
    basis = NONE_BASIS;
    confidence = "LOW";
    return { role, status, confidence, basis };
  }

  if (role === null) {
    return { role: null, status: "UNKNOWN", confidence: "LOW", basis: NONE_BASIS };
  }

  if (basis.kind === "NONE") {
    basis = glossaryBasis();
  }

  if (basis.kind === "DOCUMENT_CONTEXT" && status !== "PROVISIONAL") {
    status = "PROVISIONAL";
  }

  if (stage === "INTELLIGENCE" && basis.kind === "DOCUMENT_CONTEXT") {
    status = "PROVISIONAL";
  }

  confidence = clampConfidence(status, confidence);
  return { role, status, confidence, basis };
}

function normalizeProAudience(
  input: Omit<ProAudience, "tone" | "detailLevel">,
): Pick<ProAudience, "primaryRole" | "alternativeRoles" | "status" | "confidence" | "basis"> {
  let { primaryRole, alternativeRoles, status, confidence, basis } = input;

  alternativeRoles = alternativeRoles.filter(
    (role) => !primaryRole || role.toLowerCase() !== primaryRole.toLowerCase(),
  );

  if (status === "UNKNOWN") {
    return {
      primaryRole: null,
      alternativeRoles: [],
      status: "UNKNOWN",
      confidence: "LOW",
      basis: NONE_BASIS,
    };
  }

  if (primaryRole === null && alternativeRoles.length > 0) {
    primaryRole = alternativeRoles[0] ?? null;
    alternativeRoles = alternativeRoles.slice(1);
  }

  if (primaryRole === null) {
    return {
      primaryRole: null,
      alternativeRoles: [],
      status: "UNKNOWN",
      confidence: "LOW",
      basis: NONE_BASIS,
    };
  }

  if (basis.kind === "NONE") {
    basis = glossaryBasis();
  }

  confidence = clampConfidence(status, confidence);
  return { primaryRole, alternativeRoles, status, confidence, basis };
}

function readCustomer(raw: unknown, context: AudienceParseContext): CustomerAudience {
  const path = "audience.customer";
  const source = record(raw, path);
  const role = nullableText(source, "role", path, ROLE_MAX);
  const status = oneOf(source, "status", path, AUDIENCE_ROLE_STATUSES);
  const confidence = oneOf(source, "confidence", path, AUDIENCE_CONFIDENCE_LEVELS);
  const basis = readBasis(source.basis, `${path}.basis`, context);
  const normalized = normalizeCustomerAudience({ role, status, confidence, basis }, context.stage);
  return {
    ...normalized,
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
  const alternativeRoles = textList(source, "alternativeRoles", path, ALTERNATIVE_ROLES, ROLE_MAX);
  const normalized = normalizeProAudience({ primaryRole, alternativeRoles, status, confidence, basis });
  return {
    ...normalized,
    tone: text(source, "tone", path, TONE_MAX),
    detailLevel: oneOf(source, "detailLevel", path, AUDIENCE_DETAIL_LEVELS),
  };
}

function run<T>(parse: () => T): AudienceParseResult<T> {
  try {
    return { ok: true, value: parse() };
  } catch (error) {
    if (error instanceof AudienceError) {
      return {
        ok: false,
        diagnosticReason: error.diagnosticReason,
        message: error.message,
        ...(error.diagnosticField ? { diagnosticField: error.diagnosticField } : {}),
      };
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
