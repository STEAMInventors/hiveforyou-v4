/**
 * Offline investigation-plan compiler.
 * Reads one compiled Domain Pack snapshot and digest-pinned companion artifacts.
 * Does not evaluate a case, call a model, bind candidates, or edit DP-1 / DP-2.
 * Per-instance rows (NO_INSTANCE, UNRESOLVED_INSTANCE) are contracted here and built later.
 */
import type { PackCompileIssue } from "./domain-pack-source";
import { packDigest } from "./domain-pack-compiler";
import {
  DOMAIN_PACK_RUNTIME_SCHEMA,
  type CompiledDomainPack,
  type EffectiveDefinition,
  type PackAuthority,
  type PackPredicate,
} from "./domain-pack-source";

export const DOMAIN_INVESTIGATION_PLAN_SCHEMA = "hive.domain-investigation-plan/1" as const;
export const DOMAIN_INVESTIGATION_PLANNER_VERSION = "1.0.0" as const;
export const DOMAIN_SUPPLEMENTAL_BUNDLE_SCHEMA = "hive.domain-supplemental-bundle/1" as const;

/** Future ledger cases. This compiler does not read case facts. */
export const PER_INSTANCE_CASES = ["NO_INSTANCE", "UNRESOLVED_INSTANCE", "VERIFIED_INSTANCE"] as const;
export type PerInstanceCase = (typeof PER_INSTANCE_CASES)[number];

export const PLANNER_REASON_CODES = [
  "UNRESOLVED_SUBJECT",
  "RELATIONSHIP_UNDECLARED",
  "AMBIGUOUS_RELATIONSHIP",
  "OPERATOR_UNSUPPORTED",
  "UNCLASSIFIED",
  "UNREVIEWED_AUTHORITY",
] as const;
export type PlannerReasonCode = (typeof PLANNER_REASON_CODES)[number];

export const INVESTIGATION_TASK_KINDS = [
  "BIND_ENTITY",
  "BIND_RELATIONSHIP",
  "BIND_DOCUMENT",
  "REVIEW_CHECK",
  "EVALUATE_CHECK",
  "DECLARED_CALCULATION",
  "COMPUTE_DAYS_BETWEEN",
  "TRACE_CHAIN",
  "ASK_QUESTION",
  "APPLY_CONFLICT_PATTERN",
  "NOTE_OVERLAY",
  "NOTE_EXCEPTION",
  "NOTE_UNSUPPORTED",
  "DISABLED",
] as const;
export type InvestigationTaskKind = (typeof INVESTIGATION_TASK_KINDS)[number];

export const JOIN_GATES = ["PASSED", "RELATIONSHIP_UNDECLARED", "AMBIGUOUS_RELATIONSHIP", "NOT_APPLICABLE"] as const;
export type JoinGate = (typeof JOIN_GATES)[number];

export const SUPPLEMENTAL_SCHEMAS = [
  "hive.domain-conflict-pattern-spec/1",
  "hive.domain-state-overlay-spec/1",
  "hive.domain-fact-class-spec/1",
  "hive.domain-workflow-coverage-spec/1",
  "hive.domain-unsupported-operator-spec/1",
  "hive.domain-ontology-spec/1",
  "hive.domain-authority-register/1",
] as const;
export type SupplementalSchema = (typeof SUPPLEMENTAL_SCHEMAS)[number];

const PRESENTATION_KINDS = new Set(["persona", "report", "term", "note", "guideline", "referenceTable"]);
const SUBJECT_KINDS = new Set(["check", "calculation", "question"]);
const PRIMARY_VERIFICATION = new Set(["VERIFIED_PRIMARY_EXCERPT", "VERIFIED_PRIMARY_PARAPHRASE"]);

export type PlanJoin = { relationshipId: string; fromEntityId: string; toEntityId: string };

/**
 * Result identity for one cross-entity calculation.
 * Copied from a join that already passed validation. It is not an ontology subject,
 * and it is not chosen by entity type.
 */
export type CalculationResultBinding = {
  relationshipId: string;
  fromEntityId: string;
  toEntityId: string;
};

export type InvestigationCoverage =
  | {
      population: "PER_SUBJECT_INSTANCE";
      subjectEntityId: string;
      /** The later ledger must account for each case. No case is read here. */
      requiredCases: typeof PER_INSTANCE_CASES;
    }
  | {
      population: "UNRESOLVED_SUBJECT";
      reason: "UNRESOLVED_SUBJECT";
      subjectEntityIds: readonly string[];
    }
  | { population: "ONCE" };

export type PlanAuthority = {
  authorityId: string;
  role: string | null;
  authorityType: string;
  evidenceStrength: string;
  /** Register class such as a professional criterion. Not a permission. */
  practiceClass: string | null;
  humanReview: string;
  verificationStatus: string;
  establishes: string | null;
  doesNotEstablish: string | null;
  limitations: readonly string[];
  /** A limit role, or a role that says this authority is not the statement. */
  heldAsLimitation: boolean;
  /** True when review is unfinished or the excerpt is not a primary excerpt or paraphrase. */
  unreviewed: boolean;
};

export type InvestigationTask = {
  taskId: string;
  definitionId: string;
  sourceKind: string;
  taskKind: InvestigationTaskKind;
  subjectEntityId?: string;
  /** Present only when a structured join declaration passed validation. Null is the same-entity declaration. */
  join?: PlanJoin | null;
  /**
   * Present only for an executable cross-entity calculation whose declared join passed.
   * The result identity is this relationship and an ordered endpoint-instance pair.
   * Ontology subject mappings stay on coverage and are not this identity.
   */
  resultBinding?: CalculationResultBinding;
  joinGate: JoinGate;
  /** False unless an executable task cleared the relationship gate. DP-2 is not called here. */
  dp2Eligible: boolean;
  authorityIds: readonly string[];
  authorities: readonly PlanAuthority[];
  /** Copied from the definition when present. Not used to resolve the register. */
  authorityKind?: PackAuthority["kind"];
  coverage: InvestigationCoverage;
  reasonCodes: readonly PlannerReasonCode[];
  factClass?: string | null;
  disabledReason?: string;
  evidenceForLink?: string;
  instanceBoundary?: string;
  identityKeys?: readonly string[];
  cardinality?: string;
  requirementBasis?: string;
  comparedFields?: readonly string[];
  storedThreshold?: string | null;
  comparisonRecorded?: boolean;
  deferred?: boolean;
  operatorId?: string;
};

export type InvestigationDependency = {
  /** Predecessor. The task that must be bound first. */
  fromTaskId: string;
  /** Dependent task. */
  toTaskId: string;
  reason: string;
};

export type DomainInvestigationPlan = {
  schema: typeof DOMAIN_INVESTIGATION_PLAN_SCHEMA;
  plannerVersion: typeof DOMAIN_INVESTIGATION_PLANNER_VERSION;
  digest: string;
  pack: {
    packId: string;
    version: string;
    digest: string;
    publication: "UNPUBLISHED";
    reviewStatus: "DRAFT" | "REVIEWED";
  };
  ownership: CompiledDomainPack["ownership"];
  applicability: {
    jurisdiction: string;
    verification: "UNVERIFIED" | "REVIEWED";
    jurisdictionEstablished: boolean;
    effectiveFrom?: string;
    effectiveTo?: string;
  };
  upstream?: CompiledDomainPack["upstream"];
  supplemental: {
    schema: typeof DOMAIN_SUPPLEMENTAL_BUNDLE_SCHEMA;
    items: Array<{ schema: SupplementalSchema; digest: string }>;
  };
  presentation: Array<{
    definitionId: string;
    kind: "persona" | "report" | "term" | "note" | "guideline" | "referenceTable";
    authorities: readonly PlanAuthority[];
  }>;
  tasks: readonly InvestigationTask[];
  dependencies: readonly InvestigationDependency[];
  disabledDefinitionIds: readonly string[];
  /** Ontology rule ids that are not compiled definitions. They are not tasks. */
  uncompiledRuleIds: readonly string[];
  /** Chain annotations that do not name a compiled check or question. They are not tasks. */
  unresolvedAnnotationIds: readonly string[];
  accounting: {
    definitionCount: number;
    presentationCount: number;
    investigationDefinitionCount: number;
    supplementalTaskCount: number;
    disabledCount: number;
    taskCounts: Record<InvestigationTaskKind, number>;
  };
};

export type InvestigationPlanIssue = PackCompileIssue;
export type InvestigationPlanResult =
  | { ok: true; value: DomainInvestigationPlan }
  | { ok: false; issues: InvestigationPlanIssue[] };

export type SupplementalArtifacts = {
  ontology: unknown;
  authorityRegister: unknown;
  conflictPatterns: unknown;
  stateOverlays: unknown;
  factClasses: unknown;
  workflowCoverage: unknown;
  unsupportedOperators: unknown;
};

export type InvestigationPlanInput = {
  pack: CompiledDomainPack;
  artifacts: SupplementalArtifacts;
  digests: Record<keyof SupplementalArtifacts, string>;
};

type ObjectMap = Record<string, unknown>;
type AuthorityRecord = {
  authorityId: string;
  authorityType: string;
  evidenceStrength: string;
  humanReview: string;
  verificationStatus: string;
  establishes: string | null;
  doesNotEstablish: string | null;
  limitations: string[];
  relatedDefinitionIds: string[];
};
type RegisterModel = {
  authorities: Map<string, AuthorityRecord>;
  map: Map<string, string[]>;
  roles: Map<string, Map<string, string>>;
  practiceClass: Map<string, string>;
  unused: Set<string>;
  structural: Map<string, string>;
};
type OntologyEntity = {
  id: string;
  factClass: string | null;
  fields: Array<{ id: string; valueType: string }>;
  ruleIds: string[];
  documentKinds: string[];
  instanceBoundary?: string;
  identityKeys?: string[];
};
type OntologyRelationship = {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  evidenceForLink?: string;
  cardinality?: string;
};
type OntologyDocument = {
  id: string;
  entities: string[];
  checksSupported: string[];
  requirementBasis?: string;
};
type OntologyChain = {
  id: string;
  relationshipIds: string[];
  startEntity?: string;
  endEntity?: string;
  relevantChecks: string[];
  investigationQuestions: string[];
};
type OntologyModel = {
  entities: Map<string, OntologyEntity>;
  relationships: Map<string, OntologyRelationship>;
  documents: Map<string, OntologyDocument>;
  chains: Map<string, OntologyChain>;
  joins: Map<string, unknown>;
};
type PatternRow = { id: string; entities: string[]; relationshipIds: string[]; authorityIds: string[]; comparedFields: string[] };
type OverlayRow = { id: string; authorityIds: string[]; storedThreshold: string | null; comparisonRecorded: boolean };
type WorkflowRow = { id: string; deferred: boolean };
type OperatorRow = { id: string; definitionId: string };
type Pinned = {
  digests: Record<keyof SupplementalArtifacts, string>;
  ontology: ObjectMap;
  authorityRegister: ObjectMap;
  conflictPatterns: ObjectMap;
  stateOverlays: ObjectMap;
  factClasses: ObjectMap;
  workflowCoverage: ObjectMap;
  unsupportedOperators: ObjectMap;
  factClassNames: Set<string>;
  patterns: PatternRow[];
  overlays: OverlayRow[];
  workflows: WorkflowRow[];
  operators: OperatorRow[];
};

const isObject = (value: unknown): value is ObjectMap => !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function issue(into: InvestigationPlanIssue[], code: string, path: string, message: string): void {
  into.push({ code, path, message });
}

function fail(issues: InvestigationPlanIssue[]): InvestigationPlanResult {
  const sorted = [...issues].sort((left, right) => (left.path + "\0" + left.code + "\0" + left.message).localeCompare(right.path + "\0" + right.code + "\0" + right.message));
  return { ok: false, issues: sorted };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) freezeDeep(child);
  }
  return value;
}

function readStrings(value: unknown, path: string, issues: InvestigationPlanIssue[], code: string): string[] | null {
  if (!Array.isArray(value) || value.some((item) => !nonempty(item))) {
    issue(issues, code, path, "Expected a list of nonblank strings.");
    return null;
  }
  return value.map((item) => item.trim());
}

function duplicates(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) found.add(item);
    seen.add(item);
  }
  return [...found].sort();
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function pairKey(fromEntityId: string, toEntityId: string): string {
  return fromEntityId < toEntityId ? fromEntityId + "\0" + toEntityId : toEntityId + "\0" + fromEntityId;
}

function taskIdFor(definitionId: string): string {
  return "task:" + definitionId;
}

function slug(value: string): string {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "row";
}

function jurisdictionEstablished(jurisdiction: string): boolean {
  const label = jurisdiction.trim().toLowerCase();
  return label.length > 0 && label !== "unknown" && label !== "unspecified";
}

function heldAsLimitation(role: string | null): boolean {
  if (!role) return false;
  const upper = role.toUpperCase();
  return upper.startsWith("LIMIT_") || upper.includes("NOT_USED_AS") || upper.includes("NOT_THE_STATEMENT");
}

function schemaAccepted(observed: unknown, expected: string): boolean {
  return observed === expected || observed === expected + " (PROPOSED)";
}

function predicateExecutable(predicate: PackPredicate): boolean {
  switch (predicate.op) {
    case "REVIEW_REQUIRED":
      return false;
    case "FIELD_PRESENT":
    case "DOCUMENT_PRESENT":
      return true;
    case "ALL":
    case "ANY":
      return predicate.conditions.every(predicateExecutable);
    case "NOT":
      return predicateExecutable(predicate.condition);
    case "COMPARE":
      return typeof predicate.left !== "string" && typeof predicate.right !== "string";
    default:
      return false;
  }
}

function predicateEntities(predicate: PackPredicate, into: Set<string>): void {
  switch (predicate.op) {
    case "FIELD_PRESENT":
      into.add(predicate.entityId);
      return;
    case "ALL":
    case "ANY":
      predicate.conditions.forEach((condition) => predicateEntities(condition, into));
      return;
    case "NOT":
      predicateEntities(predicate.condition, into);
      return;
    case "COMPARE":
      for (const operand of [predicate.left, predicate.right]) {
        if (typeof operand !== "string" && operand.ref === "FIELD") into.add(operand.entityId);
      }
      return;
    default:
      return;
  }
}

function validatePack(pack: CompiledDomainPack, issues: InvestigationPlanIssue[]): boolean {
  if (!isObject(pack) || pack.schema !== DOMAIN_PACK_RUNTIME_SCHEMA) {
    issue(issues, "pack_snapshot_required", "$.pack", "Investigation planning starts from a compiled Domain Pack snapshot.");
    return false;
  }
  if (pack.publication !== "UNPUBLISHED") {
    issue(issues, "publication_unexpected", "$.pack.publication", "A compiled snapshot stays unpublished.");
  }
  if (pack.review?.status !== "DRAFT" && pack.review?.status !== "REVIEWED") {
    issue(issues, "review_status_invalid", "$.pack.review.status", "Review status must be draft or reviewed.");
  }
  if (!nonempty(pack.identity?.packId) || !nonempty(pack.identity?.version) || !/^[a-f0-9]{64}$/.test(String(pack.identity?.digest ?? ""))) {
    issue(issues, "pack_identity_invalid", "$.pack.identity", "Compiled pack identity and digest are required.");
  }
  if (!nonempty(pack.applicability?.jurisdiction) || (pack.applicability.verification !== "UNVERIFIED" && pack.applicability.verification !== "REVIEWED")) {
    issue(issues, "applicability_invalid", "$.pack.applicability", "Jurisdiction and verification are required.");
  }
  if (!Array.isArray(pack.definitions) || !Array.isArray(pack.disabledDefinitionIds)) {
    issue(issues, "pack_definitions_invalid", "$.pack.definitions", "Compiled definitions are required.");
    return false;
  }
  const ids = pack.definitions.map((definition) => definition.id);
  for (const id of duplicates(ids)) issue(issues, "duplicate_definition", id, "Duplicate compiled definition id.");
  for (const id of pack.disabledDefinitionIds) {
    if (ids.includes(id)) issue(issues, "disabled_still_effective", id, "A disabled id cannot remain an effective definition.");
  }
  return !issues.some((item) => item.code === "pack_snapshot_required" || item.code === "pack_definitions_invalid");
}

const ARTIFACT_FIELDS: Array<{ key: keyof SupplementalArtifacts; schema: SupplementalSchema; supplemental: boolean }> = [
  { key: "conflictPatterns", schema: "hive.domain-conflict-pattern-spec/1", supplemental: true },
  { key: "stateOverlays", schema: "hive.domain-state-overlay-spec/1", supplemental: true },
  { key: "factClasses", schema: "hive.domain-fact-class-spec/1", supplemental: true },
  { key: "workflowCoverage", schema: "hive.domain-workflow-coverage-spec/1", supplemental: true },
  { key: "unsupportedOperators", schema: "hive.domain-unsupported-operator-spec/1", supplemental: true },
  { key: "ontology", schema: "hive.domain-ontology-spec/1", supplemental: false },
  { key: "authorityRegister", schema: "hive.domain-authority-register/1", supplemental: false },
];

function pinArtifacts(input: InvestigationPlanInput, issues: InvestigationPlanIssue[]): Pinned | null {
  const pinned = {} as Pinned;
  pinned.digests = input.digests;
  let usable = true;
  for (const field of ARTIFACT_FIELDS) {
    const value = input.artifacts?.[field.key];
    const path = "$.artifacts." + field.key;
    if (!isObject(value)) {
      issue(issues, "missing_artifact", path, "Required companion artifact is missing.");
      usable = false;
      continue;
    }
    if (!schemaAccepted(value.schema, field.schema)) {
      issue(issues, "schema_mismatch", path + ".schema", "Companion schema does not match the pinned contract.");
    }
    if (field.supplemental && value.dp1Supported !== false) {
      issue(issues, "dp1_supported", path + ".dp1Supported", "Supplemental specifications stay outside DP-1.");
    }
    if (!field.supplemental && value.dp1Supported === true) {
      issue(issues, "dp1_supported", path + ".dp1Supported", "Pinning a companion does not promote it into DP-1.");
    }
    const expected = input.digests?.[field.key];
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) {
      issue(issues, "digest_invalid", "$.digests." + field.key, "Expected digest must be 64 lowercase hex characters.");
    } else if (packDigest(value) !== expected) {
      issue(issues, "digest_mismatch", "$.digests." + field.key, "Companion digest does not match the canonical artifact.");
    }
    pinned[field.key] = value;
  }
  if (!usable) return null;
  pinned.factClassNames = readFactClasses(pinned.factClasses, issues);
  pinned.patterns = readPatterns(pinned.conflictPatterns, issues);
  pinned.overlays = readOverlays(pinned.stateOverlays, issues);
  pinned.workflows = readWorkflows(pinned.workflowCoverage, issues);
  pinned.operators = readOperators(pinned.unsupportedOperators, issues);
  return pinned;
}

function readFactClasses(raw: ObjectMap, issues: InvestigationPlanIssue[]): Set<string> {
  const names = readStrings(raw.classes, "$.artifacts.factClasses.classes", issues, "fact_class_invalid");
  if (!names) return new Set();
  for (const name of duplicates(names)) issue(issues, "fact_class_duplicate", "$.artifacts.factClasses.classes", "Duplicate fact class: " + name);
  return new Set(names);
}

function readPatterns(raw: ObjectMap, issues: InvestigationPlanIssue[]): PatternRow[] {
  if (!Array.isArray(raw.patterns)) {
    issue(issues, "conflict_pattern_invalid", "$.artifacts.conflictPatterns.patterns", "Conflict patterns must be a list.");
    return [];
  }
  const rows: PatternRow[] = [];
  raw.patterns.forEach((pattern, index) => {
    const path = "$.artifacts.conflictPatterns.patterns[" + index + "]";
    if (!isObject(pattern) || !nonempty(pattern.id)) {
      issue(issues, "conflict_pattern_invalid", path, "Conflict pattern needs an id.");
      return;
    }
    const entities = readStrings(pattern.entities, path + ".entities", issues, "conflict_pattern_invalid") ?? [];
    const relationshipIds = readStrings(pattern.relationshipRequirements ?? [], path + ".relationshipRequirements", issues, "conflict_pattern_invalid") ?? [];
    const authorityIds = readStrings(pattern.authorityIds ?? [], path + ".authorityIds", issues, "conflict_pattern_invalid") ?? [];
    const comparedFields = Array.isArray(pattern.fields) && pattern.fields.every((field) => nonempty(field)) ? pattern.fields.map((field) => String(field)) : [];
    if (Array.isArray(pattern.fields) && comparedFields.length !== pattern.fields.length) {
      issue(issues, "conflict_pattern_invalid", path + ".fields", "Conflict pattern fields must be nonblank strings.");
    }
    rows.push({ id: pattern.id.trim(), entities, relationshipIds, authorityIds, comparedFields });
  });
  for (const id of duplicates(rows.map((row) => row.id))) issue(issues, "duplicate_id", "$.artifacts.conflictPatterns", "Duplicate conflict pattern id: " + id);
  return rows;
}

function readOverlays(raw: ObjectMap, issues: InvestigationPlanIssue[]): OverlayRow[] {
  if (!Array.isArray(raw.overlays)) {
    issue(issues, "overlay_invalid", "$.artifacts.stateOverlays.overlays", "State overlays must be a list.");
    return [];
  }
  const rows: OverlayRow[] = [];
  raw.overlays.forEach((overlay, index) => {
    const path = "$.artifacts.stateOverlays.overlays[" + index + "]";
    if (!isObject(overlay) || !nonempty(overlay.id)) {
      issue(issues, "overlay_invalid", path, "State overlay needs an id.");
      return;
    }
    const authorityIds = readStrings(overlay.authorityIds ?? [], path + ".authorityIds", issues, "overlay_invalid") ?? [];
    let storedThreshold: string | null = null;
    let comparisonRecorded = false;
    if (overlay.storedThreshold === null || overlay.storedThreshold === undefined) {
      storedThreshold = null;
      comparisonRecorded = false;
    } else if (typeof overlay.storedThreshold === "number" && Number.isFinite(overlay.storedThreshold)) {
      storedThreshold = String(overlay.storedThreshold);
      comparisonRecorded = true;
    } else if (nonempty(overlay.storedThreshold)) {
      storedThreshold = overlay.storedThreshold.trim();
      comparisonRecorded = true;
    } else {
      issue(issues, "overlay_threshold", path + ".storedThreshold", "Stored threshold must be null or a scalar.");
    }
    rows.push({ id: overlay.id.trim(), authorityIds, storedThreshold, comparisonRecorded });
  });
  for (const id of duplicates(rows.map((row) => row.id))) issue(issues, "duplicate_id", "$.artifacts.stateOverlays", "Duplicate overlay id: " + id);
  return rows;
}

function readWorkflows(raw: ObjectMap, issues: InvestigationPlanIssue[]): WorkflowRow[] {
  if (!Array.isArray(raw.rows)) {
    issue(issues, "workflow_coverage_invalid", "$.artifacts.workflowCoverage.rows", "Workflow coverage rows must be a list.");
    return [];
  }
  const used = new Set<string>();
  const rows: WorkflowRow[] = [];
  raw.rows.forEach((row, index) => {
    const path = "$.artifacts.workflowCoverage.rows[" + index + "]";
    if (!isObject(row) || !nonempty(row.workflow)) {
      issue(issues, "workflow_coverage_invalid", path, "Workflow coverage row needs a workflow name.");
      return;
    }
    let id = "workflowCoverage:" + slug(row.workflow);
    if (used.has(id)) id = id + "-" + index;
    used.add(id);
    const answers = isObject(row.answers) ? row.answers : {};
    const deferred = Object.values(answers).some((answer) => answer === "DEFERRED") || row.deferred === true;
    rows.push({ id, deferred });
  });
  return rows;
}

function readOperators(raw: ObjectMap, issues: InvestigationPlanIssue[]): OperatorRow[] {
  if (!Array.isArray(raw.operators)) {
    issue(issues, "operator_invalid", "$.artifacts.unsupportedOperators.operators", "Unsupported operators must be a list.");
    return [];
  }
  const rows: OperatorRow[] = [];
  raw.operators.forEach((operator, index) => {
    const path = "$.artifacts.unsupportedOperators.operators[" + index + "]";
    if (!isObject(operator) || !nonempty(operator.id)) {
      issue(issues, "operator_invalid", path, "Unsupported operator needs an id.");
      return;
    }
    if (operator.dp1Predicate !== false || operator.status !== "UNSUPPORTED") {
      issue(issues, "operator_promoted", path, "This operator stays unsupported and outside DP-1.");
    }
    const definitionId = operator.id.includes(":") ? operator.id.trim() : "operator:" + operator.id.trim();
    rows.push({ id: operator.id.trim(), definitionId });
  });
  for (const id of duplicates(rows.map((row) => row.definitionId))) issue(issues, "duplicate_id", "$.artifacts.unsupportedOperators", "Duplicate operator id: " + id);
  return rows;
}

function validateRegister(raw: ObjectMap, pack: CompiledDomainPack, pinned: Pinned, issues: InvestigationPlanIssue[]): RegisterModel | null {
  if (!Array.isArray(raw.authorities) || !isObject(raw.definitionAuthorityMap)) {
    issue(issues, "register_invalid", "$.artifacts.authorityRegister", "Authority register needs authorities and a definition map.");
    return null;
  }
  const authorities = new Map<string, AuthorityRecord>();
  raw.authorities.forEach((record, index) => {
    const path = "$.artifacts.authorityRegister.authorities[" + index + "]";
    if (!isObject(record) || !nonempty(record.authorityId)) {
      issue(issues, "authority_record", path, "Authority record needs an id.");
      return;
    }
    const authorityId = record.authorityId.trim();
    if (authorities.has(authorityId)) issue(issues, "duplicate_authority", path, "Duplicate authority id.");
    const related = readStrings(record.relatedDefinitionIds, path + ".relatedDefinitionIds", issues, "authority_record");
    const limitations = readStrings(record.limitations ?? [], path + ".limitations", issues, "authority_record");
    const interpretation = isObject(record.interpretation) ? record.interpretation : null;
    if (!related || !limitations || !interpretation || typeof interpretation.establishes !== "string" || typeof interpretation.doesNotEstablish !== "string") {
      issue(issues, "authority_record", path, "Authority record needs review text, limitations, and related definitions.");
      return;
    }
    if (!nonempty(record.authorityType) || !nonempty(record.evidenceStrength) || !nonempty(record.humanReview) || !nonempty(record.verificationStatus)) {
      issue(issues, "authority_record", path, "Authority type, strength, review, and verification are required.");
      return;
    }
    for (const id of duplicates(related)) issue(issues, "duplicate_authority_link", path, "Duplicate related definition: " + id);
    authorities.set(authorityId, {
      authorityId,
      authorityType: record.authorityType.trim(),
      evidenceStrength: record.evidenceStrength.trim(),
      humanReview: record.humanReview.trim(),
      verificationStatus: record.verificationStatus.trim(),
      establishes: interpretation.establishes,
      doesNotEstablish: interpretation.doesNotEstablish,
      limitations,
      relatedDefinitionIds: related,
    });
  });

  const allowed = new Set<string>([
    ...pack.definitions.map((definition) => definition.id),
    ...pinned.patterns.map((pattern) => pattern.id),
    ...pinned.overlays.map((overlay) => overlay.id),
  ]);
  const map = new Map<string, string[]>();
  for (const [definitionId, value] of Object.entries(raw.definitionAuthorityMap)) {
    const path = "$.artifacts.authorityRegister.definitionAuthorityMap." + definitionId;
    const authorityIds = readStrings(value, path, issues, "authority_map");
    if (!authorityIds) continue;
    for (const id of duplicates(authorityIds)) issue(issues, "duplicate_authority_link", path, "Duplicate mapped authority: " + id);
    if (!allowed.has(definitionId)) {
      issue(issues, "authority_map_key", path, "Map key is not a compiled definition or a pinned conflict or overlay id.");
    }
    for (const authorityId of authorityIds) {
      const record = authorities.get(authorityId);
      if (!record) {
        issue(issues, "authority_missing", path, "Mapped authority is not in the register.");
        continue;
      }
      if (!record.relatedDefinitionIds.includes(definitionId)) {
        issue(issues, "authority_inverse", path, "Map and related definitions do not agree.");
      }
    }
    map.set(definitionId, authorityIds);
  }
  for (const record of authorities.values()) {
    for (const definitionId of record.relatedDefinitionIds) {
      if (!map.get(definitionId)?.includes(record.authorityId)) {
        issue(issues, "authority_inverse", "$.artifacts.authorityRegister.authorities." + record.authorityId, "A related definition is missing from the map.");
      }
    }
  }

  const roles = new Map<string, Map<string, string>>();
  if (raw.authorityRoles !== undefined && !isObject(raw.authorityRoles)) {
    issue(issues, "authority_roles", "$.artifacts.authorityRegister.authorityRoles", "Authority roles must be an object.");
  } else if (isObject(raw.authorityRoles)) {
    for (const [definitionId, value] of Object.entries(raw.authorityRoles)) {
      const path = "$.artifacts.authorityRegister.authorityRoles." + definitionId;
      if (!isObject(value)) {
        issue(issues, "authority_roles", path, "Authority role entry must be an object.");
        continue;
      }
      const mapped = map.get(definitionId);
      const roleMap = new Map<string, string>();
      for (const [authorityId, role] of Object.entries(value)) {
        if (!nonempty(role)) issue(issues, "authority_roles", path + "." + authorityId, "Authority role must be nonblank.");
        else roleMap.set(authorityId, role.trim());
        if (!mapped?.includes(authorityId)) issue(issues, "authority_roles", path, "Role names an authority outside the definition map.");
      }
      if (mapped) {
        for (const authorityId of mapped) {
          if (!roleMap.has(authorityId)) issue(issues, "authority_roles", path, "Role object omits a mapped authority.");
        }
      }
      roles.set(definitionId, roleMap);
    }
  }

  const unused = new Set<string>();
  if (raw.unusedAuthorityDisposition !== undefined && !isObject(raw.unusedAuthorityDisposition)) {
    issue(issues, "unused_authority", "$.artifacts.authorityRegister.unusedAuthorityDisposition", "Unused authority disposition must be an object.");
  } else if (isObject(raw.unusedAuthorityDisposition)) {
    for (const authorityId of Object.keys(raw.unusedAuthorityDisposition)) {
      if (!authorities.has(authorityId)) issue(issues, "unused_authority", "$.artifacts.authorityRegister.unusedAuthorityDisposition." + authorityId, "Unused authority is not in the register.");
      unused.add(authorityId);
    }
  }
  for (const [definitionId, authorityIds] of map) {
    for (const authorityId of authorityIds) {
      if (unused.has(authorityId)) issue(issues, "unused_authority_mapped", "$.artifacts.authorityRegister.definitionAuthorityMap." + definitionId, "An unused authority is mapped.");
    }
  }

  const practiceClass = new Map<string, string>();
  const classIndex = isObject(raw.authorityClassIndex) && isObject(raw.authorityClassIndex.legend) ? raw.authorityClassIndex.legend : null;
  if (classIndex) {
    for (const [authorityType, label] of Object.entries(classIndex)) {
      if (nonempty(label)) practiceClass.set(authorityType, label.trim());
    }
  }

  const structural = new Map<string, string>();
  if (isObject(raw.structuralDefinitions)) {
    for (const [definitionId, note] of Object.entries(raw.structuralDefinitions)) {
      if (typeof note === "string") structural.set(definitionId, note);
    }
  }
  const presentation = new Set(pack.definitions.filter((definition) => PRESENTATION_KINDS.has(definition.kind)).map((definition) => definition.id));
  for (const [definitionId, note] of structural) {
    if (!presentation.has(definitionId)) continue;
    if (!/makes no domain claim/i.test(note)) continue;
    if (map.has(definitionId)) {
      issue(issues, "structural_authority", "$.artifacts.authorityRegister.structuralDefinitions." + definitionId, "A presentation definition marked as making no domain claim cannot be authority-mapped.");
    }
  }
  return { authorities, map, roles, practiceClass, unused, structural };
}

function indexJoins(value: unknown, into: Map<string, unknown>, issues: InvestigationPlanIssue[], path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => indexJoins(item, into, issues, path + "[" + index + "]"));
    return;
  }
  if (!isObject(value)) return;
  if (nonempty(value.id) && Object.prototype.hasOwnProperty.call(value, "join")) {
    if (into.has(value.id)) issue(issues, "duplicate_join", path, "More than one structured join is declared for " + value.id);
    else into.set(value.id.trim(), value.join);
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "join") continue;
    indexJoins(child, into, issues, path + "." + key);
  }
}

function collectAuthorityIds(value: unknown, into: string[], issues: InvestigationPlanIssue[], path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAuthorityIds(item, into, issues, path + "[" + index + "]"));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "authorityIds") {
      const ids = readStrings(child, path + ".authorityIds", issues, "ontology_authority");
      if (ids) into.push(...ids);
    } else collectAuthorityIds(child, into, issues, path + "." + key);
  }
}

function validateOntology(raw: ObjectMap, pack: CompiledDomainPack, register: RegisterModel, factClasses: Set<string>, issues: InvestigationPlanIssue[]): OntologyModel | null {
  const packRef = isObject(raw.packRef) ? raw.packRef : null;
  if (!packRef || packRef.packId !== pack.identity.packId || packRef.version !== pack.identity.version) {
    issue(issues, "ontology_pack_ref", "$.artifacts.ontology.packRef", "Ontology pack identity must match the compiled snapshot.");
  }
  const byKind = (kind: EffectiveDefinition["kind"]) => pack.definitions.filter((definition) => definition.kind === kind);
  const entities = new Map<string, OntologyEntity>();
  const relationships = new Map<string, OntologyRelationship>();
  const documents = new Map<string, OntologyDocument>();
  const chains = new Map<string, OntologyChain>();
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.relationships) || !Array.isArray(raw.documents)) {
    issue(issues, "ontology_invalid", "$.artifacts.ontology", "Ontology needs entity, relationship, and document lists.");
    return null;
  }
  raw.entities.forEach((entity, index) => readOntologyEntity(entity, index, entities, factClasses, issues));
  raw.relationships.forEach((relationship, index) => readOntologyRelationship(relationship, index, relationships, issues));
  raw.documents.forEach((document, index) => readOntologyDocument(document, index, documents, issues));
  if (Array.isArray(raw.chains)) raw.chains.forEach((chain, index) => readOntologyChain(chain, index, chains, issues));

  const packEntities = byKind("entity");
  const packRelationships = byKind("relationship");
  const packDocuments = byKind("document");
  if (!sameSet([...entities.keys()], packEntities.map((definition) => definition.id))) {
    issue(issues, "ontology_entity_set", "$.artifacts.ontology.entities", "Ontology entities must be the same set as the compiled pack.");
  }
  if (!sameSet([...relationships.keys()], packRelationships.map((definition) => definition.id))) {
    issue(issues, "ontology_relationship_set", "$.artifacts.ontology.relationships", "Ontology relationships must be the same set as the compiled pack.");
  }
  if (!sameSet([...documents.keys()], packDocuments.map((definition) => definition.id))) {
    issue(issues, "ontology_document_set", "$.artifacts.ontology.documents", "Ontology documents must be the same set as the compiled pack.");
  }
  for (const definition of packRelationships) {
    if (definition.kind !== "relationship") continue;
    const annotated = relationships.get(definition.id);
    if (!annotated) continue;
    if (annotated.fromEntityId !== definition.fromEntityId || annotated.toEntityId !== definition.toEntityId) {
      issue(issues, "relationship_direction", definition.id, "Ontology relationship direction does not match the compiled definition.");
    }
  }
  for (const definition of packEntities) {
    if (definition.kind !== "entity") continue;
    const annotated = entities.get(definition.id);
    if (!annotated) continue;
    for (const field of annotated.fields) {
      const packField = definition.fields.find((candidate) => candidate.id === field.id);
      if (!packField) issue(issues, "ontology_field_unknown", definition.id + "." + field.id, "Ontology field is not on the compiled entity.");
      else if (packField.valueType !== field.valueType) issue(issues, "ontology_field_type", definition.id + "." + field.id, "Ontology field type does not match the compiled entity.");
    }
    for (const documentId of annotated.documentKinds) {
      if (!documents.has(documentId)) issue(issues, "invalid_reference", definition.id, "Entity document kind is not a compiled document.");
    }
  }
  const authorityIds: string[] = [];
  collectAuthorityIds(raw, authorityIds, issues, "$.artifacts.ontology");
  for (const authorityId of authorityIds) {
    if (!register.authorities.has(authorityId)) issue(issues, "ontology_authority", authorityId, "Ontology authority id is not in the register.");
  }
  const joins = new Map<string, unknown>();
  indexJoins(raw, joins, issues, "$.artifacts.ontology");
  return { entities, relationships, documents, chains, joins };
}

function readOntologyEntity(value: unknown, index: number, into: Map<string, OntologyEntity>, factClasses: Set<string>, issues: InvestigationPlanIssue[]): void {
  const path = "$.artifacts.ontology.entities[" + index + "]";
  if (!isObject(value) || !nonempty(value.id)) {
    issue(issues, "ontology_entity", path, "Ontology entity needs an id.");
    return;
  }
  if (into.has(value.id)) issue(issues, "duplicate_id", path, "Duplicate ontology entity id.");
  const fields: Array<{ id: string; valueType: string }> = [];
  if (!Array.isArray(value.fields)) issue(issues, "ontology_entity", path + ".fields", "Ontology entity fields must be a list.");
  else value.fields.forEach((field, fieldIndex) => {
    if (!isObject(field) || !nonempty(field.id) || !nonempty(field.valueType)) {
      issue(issues, "ontology_field_unknown", path + ".fields[" + fieldIndex + "]", "Ontology field needs an id and a value type.");
      return;
    }
    fields.push({ id: field.id.trim(), valueType: field.valueType.trim() });
  });
  const ruleIds = Array.isArray(value.ruleIds) ? readStrings(value.ruleIds, path + ".ruleIds", issues, "ontology_rule") ?? [] : [];
  const documentKinds = Array.isArray(value.documentKinds) ? readStrings(value.documentKinds, path + ".documentKinds", issues, "invalid_reference") ?? [] : [];
  const identityKeys = Array.isArray(value.identityKeys) && value.identityKeys.every((key) => nonempty(key)) ? value.identityKeys.map((key) => String(key)) : undefined;
  const factClass = nonempty(value.factClass) && factClasses.has(value.factClass.trim()) ? value.factClass.trim() : null;
  into.set(value.id.trim(), {
    id: value.id.trim(),
    factClass,
    fields,
    ruleIds: [...new Set(ruleIds)],
    documentKinds,
    ...(nonempty(value.instanceBoundary) ? { instanceBoundary: value.instanceBoundary } : {}),
    ...(identityKeys ? { identityKeys } : {}),
  });
}

function readOntologyRelationship(value: unknown, index: number, into: Map<string, OntologyRelationship>, issues: InvestigationPlanIssue[]): void {
  const path = "$.artifacts.ontology.relationships[" + index + "]";
  if (!isObject(value) || !nonempty(value.id) || !nonempty(value.fromEntityId) || !nonempty(value.toEntityId)) {
    issue(issues, "ontology_relationship", path, "Ontology relationship needs an id and authored endpoints.");
    return;
  }
  if (into.has(value.id)) issue(issues, "duplicate_id", path, "Duplicate ontology relationship id.");
  into.set(value.id.trim(), {
    id: value.id.trim(),
    fromEntityId: value.fromEntityId.trim(),
    toEntityId: value.toEntityId.trim(),
    ...(nonempty(value.evidenceForLink) ? { evidenceForLink: value.evidenceForLink } : {}),
    ...(nonempty(value.cardinality) ? { cardinality: value.cardinality } : {}),
  });
}

function readOntologyDocument(value: unknown, index: number, into: Map<string, OntologyDocument>, issues: InvestigationPlanIssue[]): void {
  const path = "$.artifacts.ontology.documents[" + index + "]";
  if (!isObject(value) || !nonempty(value.id)) {
    issue(issues, "ontology_document", path, "Ontology document needs an id.");
    return;
  }
  if (into.has(value.id)) issue(issues, "duplicate_id", path, "Duplicate ontology document id.");
  const entities = Array.isArray(value.entities) ? readStrings(value.entities, path + ".entities", issues, "invalid_reference") ?? [] : [];
  const checksSupported = Array.isArray(value.checksSupported) ? readStrings(value.checksSupported, path + ".checksSupported", issues, "invalid_reference") ?? [] : [];
  into.set(value.id.trim(), {
    id: value.id.trim(),
    entities,
    checksSupported,
    ...(nonempty(value.requirementBasis) ? { requirementBasis: value.requirementBasis.trim() } : {}),
  });
}

function readOntologyChain(value: unknown, index: number, into: Map<string, OntologyChain>, issues: InvestigationPlanIssue[]): void {
  const path = "$.artifacts.ontology.chains[" + index + "]";
  if (!isObject(value) || !nonempty(value.id)) {
    issue(issues, "ontology_chain", path, "Ontology chain needs an id.");
    return;
  }
  if (into.has(value.id)) issue(issues, "duplicate_id", path, "Duplicate ontology chain id.");
  const relationshipIds = Array.isArray(value.relationshipIds) ? readStrings(value.relationshipIds, path + ".relationshipIds", issues, "invalid_reference") ?? [] : [];
  const relevantChecks = Array.isArray(value.relevantChecks) ? readStrings(value.relevantChecks, path + ".relevantChecks", issues, "invalid_reference") ?? [] : [];
  const investigationQuestions = Array.isArray(value.investigationQuestions) ? readStrings(value.investigationQuestions, path + ".investigationQuestions", issues, "invalid_reference") ?? [] : [];
  into.set(value.id.trim(), {
    id: value.id.trim(),
    relationshipIds,
    relevantChecks,
    investigationQuestions,
    ...(nonempty(value.startEntity) ? { startEntity: value.startEntity.trim() } : {}),
    ...(nonempty(value.endEntity) ? { endEntity: value.endEntity.trim() } : {}),
  });
}

function attachment(register: RegisterModel, definitionId: string): { authorityIds: string[]; authorities: PlanAuthority[]; reasons: PlannerReasonCode[] } {
  const authorityIds = [...(register.map.get(definitionId) ?? [])].sort();
  const roles = register.roles.get(definitionId);
  const authorities: PlanAuthority[] = [];
  for (const authorityId of authorityIds) {
    const record = register.authorities.get(authorityId);
    if (!record) continue;
    const unreviewed = record.humanReview !== "REVIEWED" || !PRIMARY_VERIFICATION.has(record.verificationStatus);
    authorities.push({
      authorityId,
      role: roles?.get(authorityId) ?? null,
      authorityType: record.authorityType,
      evidenceStrength: record.evidenceStrength,
      practiceClass: register.practiceClass.get(record.authorityType) ?? null,
      humanReview: record.humanReview,
      verificationStatus: record.verificationStatus,
      establishes: record.establishes,
      doesNotEstablish: record.doesNotEstablish,
      limitations: record.limitations,
      heldAsLimitation: heldAsLimitation(roles?.get(authorityId) ?? null),
      unreviewed,
    });
  }
  const reasons: PlannerReasonCode[] = authorities.some((item) => item.unreviewed) ? ["UNREVIEWED_AUTHORITY"] : [];
  return { authorityIds, authorities, reasons };
}

function coverageFor(subjectEntityIds: readonly string[]): InvestigationCoverage {
  if (subjectEntityIds.length === 1) {
    return { population: "PER_SUBJECT_INSTANCE", subjectEntityId: subjectEntityIds[0], requiredCases: PER_INSTANCE_CASES };
  }
  return { population: "UNRESOLVED_SUBJECT", reason: "UNRESOLVED_SUBJECT", subjectEntityIds };
}

function once(): InvestigationCoverage {
  return { population: "ONCE" };
}

type JoinDecision = { join?: PlanJoin | null; joinGate: JoinGate; reasons: PlannerReasonCode[] };

function decideCalculationJoin(
  definition: Extract<EffectiveDefinition, { kind: "calculation" }>,
  declared: unknown,
  relationships: Map<string, Extract<EffectiveDefinition, { kind: "relationship" }>>,
  pairCounts: Map<string, number>,
): JoinDecision {
  const bindings = definition.bindings ?? [];
  const entities = [...new Set(bindings.map((binding) => binding.entityId))];
  const start = bindings.find((binding) => binding.role === "start")?.entityId;
  const end = bindings.find((binding) => binding.role === "end")?.entityId;
  const present = declared !== undefined;
  if (entities.length === 0 && !present) return { joinGate: "NOT_APPLICABLE", reasons: [] };
  if (entities.length <= 1 && declared === null) return { join: null, joinGate: "PASSED", reasons: [] };
  if (!present || declared === null || !isObject(declared) || !nonempty(declared.relationshipId) || Object.keys(declared).some((key) => key !== "relationshipId")) {
    return { joinGate: "RELATIONSHIP_UNDECLARED", reasons: ["RELATIONSHIP_UNDECLARED"] };
  }
  const relationship = relationships.get(declared.relationshipId.trim());
  if (!relationship || !start || !end || relationship.fromEntityId !== start || relationship.toEntityId !== end) {
    return { joinGate: "RELATIONSHIP_UNDECLARED", reasons: ["RELATIONSHIP_UNDECLARED"] };
  }
  const join = { relationshipId: relationship.id, fromEntityId: relationship.fromEntityId, toEntityId: relationship.toEntityId };
  if ((pairCounts.get(pairKey(relationship.fromEntityId, relationship.toEntityId)) ?? 0) > 1) {
    return { join, joinGate: "AMBIGUOUS_RELATIONSHIP", reasons: ["AMBIGUOUS_RELATIONSHIP"] };
  }
  return { join, joinGate: "PASSED", reasons: [] };
}

function decideCheckJoin(
  entityIds: readonly string[],
  declared: unknown,
  relationships: Map<string, Extract<EffectiveDefinition, { kind: "relationship" }>>,
  pairCounts: Map<string, number>,
): JoinDecision {
  if (declared === undefined) {
    return entityIds.length >= 2
      ? { joinGate: "RELATIONSHIP_UNDECLARED", reasons: ["RELATIONSHIP_UNDECLARED"] }
      : { joinGate: "NOT_APPLICABLE", reasons: [] };
  }
  if (declared === null) {
    return entityIds.length <= 1
      ? { join: null, joinGate: "PASSED", reasons: [] }
      : { joinGate: "RELATIONSHIP_UNDECLARED", reasons: ["RELATIONSHIP_UNDECLARED"] };
  }
  if (!isObject(declared) || !nonempty(declared.relationshipId) || Object.keys(declared).some((key) => key !== "relationshipId")) {
    return { joinGate: "RELATIONSHIP_UNDECLARED", reasons: ["RELATIONSHIP_UNDECLARED"] };
  }
  const relationship = relationships.get(declared.relationshipId.trim());
  const endpoints = new Set(entityIds);
  if (!relationship || endpoints.size !== 2 || !endpoints.has(relationship.fromEntityId) || !endpoints.has(relationship.toEntityId)) {
    return { joinGate: "RELATIONSHIP_UNDECLARED", reasons: ["RELATIONSHIP_UNDECLARED"] };
  }
  const join = { relationshipId: relationship.id, fromEntityId: relationship.fromEntityId, toEntityId: relationship.toEntityId };
  if ((pairCounts.get(pairKey(relationship.fromEntityId, relationship.toEntityId)) ?? 0) > 1) {
    return { join, joinGate: "AMBIGUOUS_RELATIONSHIP", reasons: ["AMBIGUOUS_RELATIONSHIP"] };
  }
  return { join, joinGate: "PASSED", reasons: [] };
}

function uniqueReasons(reasons: readonly PlannerReasonCode[]): PlannerReasonCode[] {
  return [...new Set(reasons)].sort();
}

function buildPlan(pack: CompiledDomainPack, pinned: Pinned, register: RegisterModel, ontology: OntologyModel, issues: InvestigationPlanIssue[]): Omit<DomainInvestigationPlan, "digest"> | null {
  const definitions = new Map(pack.definitions.map((definition) => [definition.id, definition]));
  const relationships = new Map([...definitions.values()].filter((definition): definition is Extract<EffectiveDefinition, { kind: "relationship" }> => definition.kind === "relationship").map((definition) => [definition.id, definition]));
  const pairCounts = new Map<string, number>();
  for (const relationship of relationships.values()) {
    const key = pairKey(relationship.fromEntityId, relationship.toEntityId);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  const subjects = new Map<string, string[]>();
  const uncompiled = new Set<string>();
  const unresolvedAnnotations = new Set<string>();
  for (const entity of ontology.entities.values()) {
    for (const ruleId of entity.ruleIds) {
      const definition = definitions.get(ruleId);
      if (!definition) {
        uncompiled.add(ruleId);
        continue;
      }
      if (!SUBJECT_KINDS.has(definition.kind)) {
        issue(issues, "rule_subject_kind", entity.id, "A subject declaration must name a check, calculation, or question.");
        continue;
      }
      const owners = subjects.get(ruleId) ?? [];
      if (!owners.includes(entity.id)) owners.push(entity.id);
      subjects.set(ruleId, owners);
    }
  }
  for (const pattern of pinned.patterns) {
    for (const entityId of pattern.entities) if (!definitions.has(entityId) || definitions.get(entityId)?.kind !== "entity") issue(issues, "invalid_reference", pattern.id, "Conflict pattern names an unknown entity.");
    for (const relationshipId of pattern.relationshipIds) if (!relationships.has(relationshipId)) issue(issues, "invalid_reference", pattern.id, "Conflict pattern names an unknown relationship.");
    for (const authorityId of pattern.authorityIds) if (!register.authorities.has(authorityId)) issue(issues, "invalid_reference", pattern.id, "Conflict pattern names an unknown authority.");
  }
  for (const overlay of pinned.overlays) {
    for (const authorityId of overlay.authorityIds) if (!register.authorities.has(authorityId)) issue(issues, "invalid_reference", overlay.id, "Overlay names an unknown authority.");
  }
  for (const document of ontology.documents.values()) {
    for (const entityId of document.entities) if (definitions.get(entityId)?.kind !== "entity") issue(issues, "invalid_reference", document.id, "Document names an unknown entity.");
    for (const checkId of document.checksSupported) if (definitions.get(checkId)?.kind !== "check") issue(issues, "invalid_reference", document.id, "Document names an unknown check.");
  }
  for (const chain of ontology.chains.values()) {
    if (!definitions.has(chain.id) || definitions.get(chain.id)?.kind !== "chain") continue;
    for (const id of chain.relationshipIds) {
      const kind = definitions.get(id)?.kind;
      if (kind !== "relationship" && kind !== "chain") issue(issues, "invalid_reference", chain.id, "Chain dependency is not a relationship or a chain.");
    }
    if (chain.startEntity && definitions.get(chain.startEntity)?.kind !== "entity") issue(issues, "invalid_reference", chain.id, "Chain start entity is unknown.");
    if (chain.endEntity && definitions.get(chain.endEntity)?.kind !== "entity") issue(issues, "invalid_reference", chain.id, "Chain end entity is unknown.");
    for (const checkId of chain.relevantChecks) if (definitions.get(checkId)?.kind !== "check") unresolvedAnnotations.add(checkId);
    for (const questionId of chain.investigationQuestions) if (definitions.get(questionId)?.kind !== "question") unresolvedAnnotations.add(questionId);
  }

  const presentation: DomainInvestigationPlan["presentation"] = [];
  const tasks: InvestigationTask[] = [];
  const supplementalIds = new Set<string>([
    ...pinned.patterns.map((pattern) => pattern.id),
    ...pinned.overlays.map((overlay) => overlay.id),
    ...pinned.workflows.map((row) => row.id),
    ...pinned.operators.map((operator) => operator.definitionId),
    ...pack.disabledDefinitionIds,
  ]);

  for (const definition of [...pack.definitions].sort((left, right) => left.id.localeCompare(right.id))) {
    if (supplementalIds.has(definition.id)) issue(issues, "definition_collision", definition.id, "A compiled definition id collides with a supplemental row.");
    if (PRESENTATION_KINDS.has(definition.kind)) {
      const cited = attachment(register, definition.id);
      presentation.push({
        definitionId: definition.id,
        kind: definition.kind as DomainInvestigationPlan["presentation"][number]["kind"],
        authorities: cited.authorities,
      });
      continue;
    }
    tasks.push(definitionTask(definition, subjects.get(definition.id) ?? [], register, ontology, relationships, pairCounts));
  }

  for (const pattern of [...pinned.patterns].sort((left, right) => left.id.localeCompare(right.id))) {
    const cited = attachment(register, pattern.id);
    tasks.push({
      taskId: taskIdFor(pattern.id),
      definitionId: pattern.id,
      sourceKind: "conflictPattern",
      taskKind: "APPLY_CONFLICT_PATTERN",
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      authorityIds: cited.authorityIds,
      authorities: cited.authorities,
      coverage: once(),
      reasonCodes: uniqueReasons(cited.reasons),
      ...(pattern.comparedFields.length ? { comparedFields: pattern.comparedFields } : {}),
    });
  }
  for (const overlay of [...pinned.overlays].sort((left, right) => left.id.localeCompare(right.id))) {
    const cited = attachment(register, overlay.id);
    tasks.push({
      taskId: taskIdFor(overlay.id),
      definitionId: overlay.id,
      sourceKind: "stateOverlay",
      taskKind: "NOTE_OVERLAY",
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      authorityIds: cited.authorityIds,
      authorities: cited.authorities,
      coverage: once(),
      reasonCodes: uniqueReasons(cited.reasons),
      storedThreshold: overlay.storedThreshold,
      comparisonRecorded: overlay.comparisonRecorded,
    });
  }
  for (const row of pinned.workflows) {
    tasks.push({
      taskId: taskIdFor(row.id),
      definitionId: row.id,
      sourceKind: "workflowCoverage",
      taskKind: "NOTE_EXCEPTION",
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      authorityIds: [],
      authorities: [],
      coverage: once(),
      reasonCodes: [],
      deferred: row.deferred,
    });
  }
  for (const operator of [...pinned.operators].sort((left, right) => left.definitionId.localeCompare(right.definitionId))) {
    tasks.push({
      taskId: taskIdFor(operator.definitionId),
      definitionId: operator.definitionId,
      sourceKind: "unsupportedOperator",
      taskKind: "NOTE_UNSUPPORTED",
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      authorityIds: [],
      authorities: [],
      coverage: once(),
      reasonCodes: ["OPERATOR_UNSUPPORTED"],
      operatorId: operator.id,
    });
  }
  for (const definitionId of [...pack.disabledDefinitionIds].sort()) {
    const reason = [...(pack.editHistory ?? [])].reverse().find((edit) => edit.op === "disable" && edit.definitionId === definitionId)?.reason;
    tasks.push({
      taskId: taskIdFor(definitionId),
      definitionId,
      sourceKind: "disabled",
      taskKind: "DISABLED",
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      authorityIds: [],
      authorities: [],
      coverage: once(),
      reasonCodes: [],
      ...(reason ? { disabledReason: reason } : {}),
    });
  }

  const taskIds = new Map(tasks.map((task) => [task.definitionId, task.taskId]));
  const dependencies = buildDependencies(pack, ontology, pinned.patterns, tasks, taskIds, issues);
  const definitionTaskIds = new Set(tasks.filter((task) => definitions.has(task.definitionId)).map((task) => task.definitionId));
  if (definitionTaskIds.size + presentation.length !== pack.definitions.length) {
    issue(issues, "accounting_gap", "$.tasks", "Every compiled definition must be a presentation row or one investigation task.");
  }
  for (const row of presentation) {
    if (definitionTaskIds.has(row.definitionId)) issue(issues, "accounting_gap", row.definitionId, "A definition cannot be both presentation and an investigation task.");
  }
  if (issues.length) return null;

  const cycle = findCycle(tasks.map((task) => task.taskId), dependencies);
  if (cycle) {
    issue(issues, "dependency_cycle", "$.dependencies", "Dependency cycle: " + cycle.join(" -> "));
    return null;
  }

  const sortedTasks = [...tasks].sort((left, right) => left.taskId.localeCompare(right.taskId));
  const taskCounts = Object.fromEntries(INVESTIGATION_TASK_KINDS.map((kind) => [kind, sortedTasks.filter((task) => task.taskKind === kind).length])) as Record<InvestigationTaskKind, number>;
  const supplementalTaskCount = sortedTasks.filter((task) => !definitions.has(task.definitionId) && task.taskKind !== "DISABLED").length;
  return {
    schema: DOMAIN_INVESTIGATION_PLAN_SCHEMA,
    plannerVersion: DOMAIN_INVESTIGATION_PLANNER_VERSION,
    pack: {
      packId: pack.identity.packId,
      version: pack.identity.version,
      digest: pack.identity.digest,
      publication: "UNPUBLISHED",
      reviewStatus: pack.review.status,
    },
    ownership: pack.ownership,
    applicability: {
      jurisdiction: pack.applicability.jurisdiction,
      verification: pack.applicability.verification,
      jurisdictionEstablished: jurisdictionEstablished(pack.applicability.jurisdiction),
      ...(pack.applicability.effectiveFrom ? { effectiveFrom: pack.applicability.effectiveFrom } : {}),
      ...(pack.applicability.effectiveTo ? { effectiveTo: pack.applicability.effectiveTo } : {}),
    },
    ...(pack.upstream ? { upstream: pack.upstream } : {}),
    supplemental: {
      schema: DOMAIN_SUPPLEMENTAL_BUNDLE_SCHEMA,
      items: ARTIFACT_FIELDS.map((field) => ({ schema: field.schema, digest: pinned.digests[field.key] })),
    },
    presentation: presentation.sort((left, right) => left.definitionId.localeCompare(right.definitionId)),
    tasks: sortedTasks,
    dependencies: dependencies.sort((left, right) => (left.fromTaskId + "\0" + left.toTaskId + "\0" + left.reason).localeCompare(right.fromTaskId + "\0" + right.toTaskId + "\0" + right.reason)),
    disabledDefinitionIds: [...pack.disabledDefinitionIds].sort(),
    uncompiledRuleIds: [...uncompiled].sort(),
    /** Chain annotations that do not name a compiled check or question. They are not tasks. */
    unresolvedAnnotationIds: [...unresolvedAnnotations].sort(),
    accounting: {
      definitionCount: pack.definitions.length,
      presentationCount: presentation.length,
      investigationDefinitionCount: definitionTaskIds.size,
      supplementalTaskCount,
      disabledCount: pack.disabledDefinitionIds.length,
      taskCounts,
    },
  };
}

function definitionTask(
  definition: EffectiveDefinition,
  subjectEntityIds: readonly string[],
  register: RegisterModel,
  ontology: OntologyModel,
  relationships: Map<string, Extract<EffectiveDefinition, { kind: "relationship" }>>,
  pairCounts: Map<string, number>,
): InvestigationTask {
  const cited = attachment(register, definition.id);
  const base = {
    taskId: taskIdFor(definition.id),
    definitionId: definition.id,
    authorityIds: cited.authorityIds,
    authorities: cited.authorities,
    ...(definition.authority ? { authorityKind: definition.authority.kind } : {}),
  };
  if (definition.kind === "entity") {
    const annotated = ontology.entities.get(definition.id);
    const reasons: PlannerReasonCode[] = [...cited.reasons];
    if (!annotated?.factClass) reasons.push("UNCLASSIFIED");
    return {
      ...base,
      sourceKind: "entity",
      taskKind: "BIND_ENTITY",
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      coverage: once(),
      reasonCodes: uniqueReasons(reasons),
      factClass: annotated?.factClass ?? null,
      ...(annotated?.instanceBoundary ? { instanceBoundary: annotated.instanceBoundary } : {}),
      ...(annotated?.identityKeys ? { identityKeys: annotated.identityKeys } : {}),
    };
  }
  if (definition.kind === "relationship") {
    const annotated = ontology.relationships.get(definition.id);
    return {
      ...base,
      sourceKind: "relationship",
      taskKind: "BIND_RELATIONSHIP",
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      coverage: once(),
      reasonCodes: uniqueReasons(cited.reasons),
      ...(annotated?.evidenceForLink ? { evidenceForLink: annotated.evidenceForLink } : {}),
      ...(annotated?.cardinality ? { cardinality: annotated.cardinality } : {}),
    };
  }
  if (definition.kind === "document") {
    const annotated = ontology.documents.get(definition.id);
    return {
      ...base,
      sourceKind: "document",
      taskKind: "BIND_DOCUMENT",
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      coverage: once(),
      reasonCodes: uniqueReasons(cited.reasons),
      ...(annotated?.requirementBasis ? { requirementBasis: annotated.requirementBasis } : {}),
    };
  }
  if (definition.kind === "chain" || definition.kind === "workflow") {
    return {
      ...base,
      sourceKind: definition.kind,
      taskKind: definition.kind === "chain" ? "TRACE_CHAIN" : "NOTE_EXCEPTION",
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      coverage: once(),
      reasonCodes: uniqueReasons(cited.reasons),
    };
  }
  const owners = [...subjectEntityIds].sort();
  const coverage = definition.kind === "check" || definition.kind === "calculation" || definition.kind === "question" ? coverageFor(owners) : once();
  const subjectReasons: PlannerReasonCode[] = coverage.population === "UNRESOLVED_SUBJECT" ? ["UNRESOLVED_SUBJECT"] : [];
  const subjectEntityId = coverage.population === "PER_SUBJECT_INSTANCE" ? coverage.subjectEntityId : undefined;
  if (definition.kind === "question") {
    return {
      ...base,
      sourceKind: "question",
      taskKind: "ASK_QUESTION",
      ...(subjectEntityId ? { subjectEntityId } : {}),
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      coverage,
      reasonCodes: uniqueReasons([...cited.reasons, ...subjectReasons]),
    };
  }
  if (definition.kind === "check") {
    const entities = new Set<string>();
    predicateEntities(definition.criterion, entities);
    const executable = predicateExecutable(definition.criterion);
    const decision = executable ? decideCheckJoin([...entities], ontology.joins.get(definition.id), relationships, pairCounts) : { joinGate: "NOT_APPLICABLE" as const, reasons: [] as PlannerReasonCode[] };
    return {
      ...base,
      sourceKind: "check",
      taskKind: executable ? "EVALUATE_CHECK" : "REVIEW_CHECK",
      ...(subjectEntityId ? { subjectEntityId } : {}),
      ...(decision.join !== undefined ? { join: decision.join } : {}),
      joinGate: decision.joinGate,
      dp2Eligible: executable && (decision.joinGate === "PASSED" || decision.joinGate === "NOT_APPLICABLE"),
      coverage,
      reasonCodes: uniqueReasons([...cited.reasons, ...subjectReasons, ...decision.reasons]),
    };
  }
  if (definition.kind !== "calculation") {
    return {
      ...base,
      sourceKind: definition.kind,
      taskKind: "NOTE_EXCEPTION",
      joinGate: "NOT_APPLICABLE",
      dp2Eligible: false,
      coverage: once(),
      reasonCodes: uniqueReasons(cited.reasons),
    };
  }
  const executable = definition.state === "EXECUTABLE" && definition.operator === "DAYS_BETWEEN";
  const unsupported = definition.state === "EXECUTABLE" && definition.operator !== "DAYS_BETWEEN";
  const decision = executable || definition.bindings?.length || ontology.joins.has(definition.id)
    ? decideCalculationJoin(definition, ontology.joins.get(definition.id), relationships, pairCounts)
    : { joinGate: "NOT_APPLICABLE" as const, reasons: [] as PlannerReasonCode[] };
  const resultBinding: CalculationResultBinding | undefined = executable && decision.joinGate === "PASSED" && decision.join
    ? { relationshipId: decision.join.relationshipId, fromEntityId: decision.join.fromEntityId, toEntityId: decision.join.toEntityId }
    : undefined;
  const extra: PlannerReasonCode[] = unsupported ? ["OPERATOR_UNSUPPORTED"] : [];
  return {
    ...base,
    sourceKind: "calculation",
    taskKind: unsupported ? "NOTE_UNSUPPORTED" : executable ? "COMPUTE_DAYS_BETWEEN" : "DECLARED_CALCULATION",
    ...(subjectEntityId ? { subjectEntityId } : {}),
    ...(decision.join !== undefined ? { join: decision.join } : {}),
    ...(resultBinding ? { resultBinding } : {}),
    joinGate: decision.joinGate,
    dp2Eligible: executable && decision.joinGate === "PASSED",
    coverage,
    reasonCodes: uniqueReasons([...cited.reasons, ...(resultBinding ? [] : subjectReasons), ...decision.reasons, ...extra]),
  };
}

function buildDependencies(
  pack: CompiledDomainPack,
  ontology: OntologyModel,
  patterns: readonly PatternRow[],
  tasks: readonly InvestigationTask[],
  taskIds: Map<string, string>,
  issues: InvestigationPlanIssue[],
): InvestigationDependency[] {
  const edges: InvestigationDependency[] = [];
  const seen = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.definitionId, task]));
  const add = (fromId: string | undefined, toId: string | undefined, reason: string) => {
    if (!fromId || !toId) return;
    if (fromId === toId) {
      issue(issues, "dependency_cycle", fromId, "A task cannot depend on itself.");
      return;
    }
    const fromTaskId = taskIds.get(fromId);
    const toTaskId = taskIds.get(toId);
    if (!fromTaskId || !toTaskId) return;
    const key = fromTaskId + "\0" + toTaskId + "\0" + reason;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ fromTaskId, toTaskId, reason });
  };
  const definitions = new Map(pack.definitions.map((definition) => [definition.id, definition]));
  for (const definition of pack.definitions) {
    if (definition.kind === "relationship") {
      add(definition.fromEntityId, definition.id, "relationship_endpoint");
      add(definition.toEntityId, definition.id, "relationship_endpoint");
    }
    if (definition.kind === "document") {
      for (const entityId of ontology.documents.get(definition.id)?.entities ?? []) add(entityId, definition.id, "document_entity");
      for (const checkId of definition.settlesCheckIds) add(definition.id, checkId, "document_settles_check");
      for (const checkId of ontology.documents.get(definition.id)?.checksSupported ?? []) add(definition.id, checkId, "document_supports_check");
    }
    const task = byId.get(definition.id);
    if (task?.coverage.population === "PER_SUBJECT_INSTANCE") add(task.coverage.subjectEntityId, definition.id, "subject_entity");
    if (definition.kind === "calculation") {
      for (const binding of definition.bindings ?? []) add(binding.entityId, definition.id, "binding_entity");
    }
    if ((task?.joinGate === "PASSED" || task?.joinGate === "AMBIGUOUS_RELATIONSHIP") && task.join) {
      add(task.join.relationshipId, definition.id, "declared_join");
    }
  }
  for (const chain of ontology.chains.values()) {
    if (definitions.get(chain.id)?.kind !== "chain") continue;
    for (const id of chain.relationshipIds) {
      const kind = definitions.get(id)?.kind;
      if (kind === "relationship" || kind === "chain") add(id, chain.id, "chain_dependency");
    }
    if (chain.startEntity) add(chain.startEntity, chain.id, "chain_endpoint");
    if (chain.endEntity) add(chain.endEntity, chain.id, "chain_endpoint");
    for (const checkId of chain.relevantChecks) add(chain.id, checkId, "chain_check");
    for (const questionId of chain.investigationQuestions) add(chain.id, questionId, "chain_question");
  }
  for (const pattern of patterns) {
    for (const entityId of pattern.entities) add(entityId, pattern.id, "conflict_entity");
    for (const relationshipId of pattern.relationshipIds) add(relationshipId, pattern.id, "conflict_relationship");
  }
  return edges;
}

function findCycle(nodeIds: readonly string[], edges: readonly InvestigationDependency[]): string[] | null {
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of nodeIds) {
    outgoing.set(id, []);
    indegree.set(id, 0);
  }
  for (const edge of edges) {
    if (!outgoing.has(edge.fromTaskId) || !indegree.has(edge.toTaskId)) return [edge.fromTaskId, edge.toTaskId];
    outgoing.get(edge.fromTaskId)?.push(edge.toTaskId);
    indegree.set(edge.toTaskId, (indegree.get(edge.toTaskId) ?? 0) + 1);
  }
  const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id).sort();
  let seen = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    seen += 1;
    const nextIds = [...(outgoing.get(id) ?? [])].sort();
    for (const next of nextIds) {
      const degree = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
    queue.sort();
  }
  if (seen === nodeIds.length) return null;
  const remaining = [...indegree.entries()].filter(([, degree]) => degree > 0).map(([id]) => id).sort();
  return remaining.slice(0, 8);
}

export function compileInvestigationPlan(input: InvestigationPlanInput): InvestigationPlanResult {
  const issues: InvestigationPlanIssue[] = [];
  if (!input || !validatePack(input.pack, issues)) return fail(issues);
  const pinned = pinArtifacts(input, issues);
  if (!pinned) return fail(issues);
  const register = validateRegister(pinned.authorityRegister, input.pack, pinned, issues);
  if (!register) return fail(issues);
  const ontology = validateOntology(pinned.ontology, input.pack, register, pinned.factClassNames, issues);
  if (!ontology || issues.length) return fail(issues);
  const material = buildPlan(input.pack, pinned, register, ontology, issues);
  if (!material || issues.length) return fail(issues);
  const digest = packDigest(material);
  return { ok: true, value: freezeDeep({ ...material, digest }) };
}
