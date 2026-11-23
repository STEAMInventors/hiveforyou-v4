/**
 * Editable authoring contract for independently owned Domain Pack editions.
 * Source definitions are data, never executable code or authorization policy.
 * This module is intentionally browser-safe for a future Domain Studio.
 */
export const DOMAIN_PACK_SOURCE_SCHEMA = "hive.domain-pack-source/1" as const;
export const DOMAIN_PACK_RUNTIME_SCHEMA = "hive.domain-pack-runtime/1" as const;
export const DOMAIN_PACK_COMPILER_VERSION = "1.0.0" as const;

export type PackOwner = {
  scope: "PLATFORM" | "PRO" | "FIRM";
  ownerId: string;
  authoredBy: string;
};

export type PackAuthority = {
  kind: "REGULATION" | "CASE_LAW" | "PROFESSIONAL_PRACTICE" | "FIRM_POLICY" | "REFERENCE" | "OBSERVATION";
  citation: string;
  reviewedBy?: string;
  reviewedAt?: string;
};

export type PackApplicability = {
  /** A label, not a claim that legal scope has been independently validated. */
  jurisdiction: string;
  verification: "UNVERIFIED" | "REVIEWED";
  effectiveFrom?: string;
  effectiveTo?: string;
  intentHints?: string[];
  documentHints?: string[];
};

export type FieldValueType = "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "MONEY" | "QUANTITY";
export type FieldDefinition = { id: string; valueType: FieldValueType; required?: boolean; unit?: string };

export type PackPredicate =
  | { op: "REVIEW_REQUIRED" }
  | { op: "FIELD_PRESENT"; entityId: string; fieldId: string }
  | { op: "DOCUMENT_PRESENT"; documentKindId: string }
  | { op: "ALL" | "ANY"; conditions: PackPredicate[] }
  | { op: "NOT"; condition: PackPredicate }
  | { op: "COMPARE"; left: string; comparator: "EQ" | "NE" | "LT" | "LTE" | "GT" | "GTE"; right: string };

export const PACK_CALCULATION_OPERATORS = [
  "DAYS_BETWEEN", "DIFFERENCE", "RATE_PER_WEEK", "SUM_BY", "ADD_INTERVAL", "REFERENCE_GAP",
] as const;
export type PackCalculationOperator = (typeof PACK_CALCULATION_OPERATORS)[number];

export const PACK_WORKFLOW_ACTIONS = [
  "REQUEST_DOCUMENT", "ASK_QUESTION", "FLAG_REVIEW", "GENERATE_REPORT",
] as const;
export type PackWorkflowAction = (typeof PACK_WORKFLOW_ACTIONS)[number];

type DefinitionBase = {
  id: string;
  label: string;
  /** Distinguishes a professional preference from a verified authority. */
  authority?: PackAuthority;
};

export type PackDefinition =
  | (DefinitionBase & { kind: "entity"; fields: FieldDefinition[] })
  | (DefinitionBase & { kind: "relationship"; fromEntityId: string; toEntityId: string; evidenceRequired: boolean })
  | (DefinitionBase & { kind: "document"; aliases: string[]; appliesWhen: PackPredicate; settlesCheckIds: string[] })
  | (DefinitionBase & { kind: "check"; criterion: PackPredicate; question?: string; evidenceDescription?: string })
  | (DefinitionBase & { kind: "calculation"; operator: PackCalculationOperator; inputFields: string[]; state: "EXECUTABLE" | "DECLARATION_ONLY"; legacyInputs?: string })
  | (DefinitionBase & { kind: "chain"; links: string[] })
  | (DefinitionBase & { kind: "question"; audience: "customer" | "professional" | "all"; text: string; appliesWhen: PackPredicate })
  | (DefinitionBase & { kind: "workflow"; steps: { id: string; action: PackWorkflowAction; requiresReview: boolean }[] })
  | (DefinitionBase & { kind: "report"; audience: "customer" | "professional"; sections: { id: string; heading: string; blocks: string[] }[] })
  | (DefinitionBase & { kind: "term"; meaning: string })
  | (DefinitionBase & { kind: "referenceTable"; columns: string[]; rows: string[][] })
  | (DefinitionBase & { kind: "persona"; audience: "customer" | "professional"; context: string; questionIds: string[] })
  | (DefinitionBase & { kind: "note"; text: string; showWhen: string });

export type PackUpstreamRef = { packId: string; version: string; digest: string };
export type PackEdit =
  | { op: "add"; definitionId: string; definition: PackDefinition; reason: string }
  | { op: "replace" | "supersede"; definitionId: string; definition: PackDefinition; reason: string }
  | { op: "disable"; definitionId: string; reason: string };

export type DomainPackSource = {
  schema: typeof DOMAIN_PACK_SOURCE_SCHEMA;
  identity: { packId: string; version: string; title: string; description?: string };
  ownership: PackOwner;
  applicability: PackApplicability;
  upstream?: PackUpstreamRef;
  /** Independent editions define a complete set. Derived editions use changes. */
  definitions: PackDefinition[];
  changes: PackEdit[];
  review: { status: "DRAFT" | "REVIEWED"; reviewerId?: string; reviewedAt?: string };
};

export type EffectiveDefinition = PackDefinition & {
  /** Stable origin for display and audit; disabled definitions stay in lineage. */
  origin: { packId: string; version: string; operation: "base" | PackEdit["op"]; reason?: string };
};

export type CompiledDomainPack = {
  schema: typeof DOMAIN_PACK_RUNTIME_SCHEMA;
  compilerVersion: typeof DOMAIN_PACK_COMPILER_VERSION;
  identity: DomainPackSource["identity"] & { digest: string };
  ownership: PackOwner;
  applicability: PackApplicability;
  upstream?: PackUpstreamRef;
  /** Compilation never grants publishing rights. Publication is an authorized server-side step. */
  publication: "UNPUBLISHED";
  review: DomainPackSource["review"];
  definitions: EffectiveDefinition[];
  disabledDefinitionIds: string[];
  /** An immutable audit of applied edits, including a human reason. */
  editHistory: PackEdit[];
};

export type PackCompileIssue = { code: string; path: string; message: string };
export type PackCompileResult =
  | { ok: true; value: CompiledDomainPack }
  | { ok: false; issues: PackCompileIssue[] };
