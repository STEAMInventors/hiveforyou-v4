/**
 * DP-1 offline compiler. No DB access, model calls, evaluation or publication.
 * Pack authoring data is untrusted; fail closed on invalid definitions or edits.
 * Node-only on purpose: the source contract stays browser-safe for Domain Studio.
 */
import { createHash } from "node:crypto";
import {
  DOMAIN_PACK_COMPILER_VERSION,
  DOMAIN_PACK_RUNTIME_SCHEMA,
  DOMAIN_PACK_SOURCE_SCHEMA,
  PACK_CALCULATION_OPERATORS,
  PACK_WORKFLOW_ACTIONS,
  type CompiledDomainPack,
  type DomainPackSource,
  type EffectiveDefinition,
  type PackCompileIssue,
  type PackCompileResult,
  type PackDefinition,
  type PackPredicate,
} from "./domain-pack-source";

const ID = /^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DIGEST = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_KINDS = new Set([
  "entity", "relationship", "document", "check", "calculation", "chain",
  "question", "workflow", "report", "term", "referenceTable", "persona", "note", "guideline",
]);
const BLOCKS = new Set([
  "documents", "spine_table", "conflicts", "timeline", "outside_spine", "checklist",
  "chains", "questions", "unanswered", "terms", "general_notes", "gaps", "computed",
]);
const DEFINITION_KEYS: Record<string, readonly string[]> = {
  entity: ["fields"],
  relationship: ["fromEntityId", "toEntityId", "evidenceRequired"],
  document: ["aliases", "appliesWhen", "settlesCheckIds", "timingDescription", "applicabilityDescription"],
  check: ["criterion", "question", "evidenceDescription"],
  calculation: ["operator", "inputFields", "state", "legacyInputs", "scope"],
  chain: ["links"],
  question: ["audience", "text", "appliesWhen", "conditionDescription", "rationale"],
  workflow: ["steps"],
  report: ["audience", "sections", "voice"],
  term: ["meaning"],
  referenceTable: ["columns", "rows"],
  persona: ["audience", "context", "questionIds", "knows", "doesNotKnow", "decisions", "usefulWhen", "leaveOut", "successTest"],
  note: ["text", "showWhen"],
  guideline: ["text", "scope"],
};

type ObjectMap = Record<string, unknown>;
const isObject = (v: unknown): v is ObjectMap => !!v && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const unique = (items: readonly string[]): boolean => new Set(items).size === items.length;
const validDate = (v: unknown): boolean => typeof v === "string" && DATE.test(v) &&
  !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

/** Canonical stable JSON is used for reproducible SHA-256 artifact identity. */
export function canonicalPackJson(input: unknown): string {
  if (Array.isArray(input)) return "[" + input.map(canonicalPackJson).join(",") + "]";
  if (input !== null && typeof input === "object") {
    const obj = input as ObjectMap;
    return "{" + Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalPackJson(obj[k])).join(",") + "}";
  }
  return JSON.stringify(input);
}

export function packDigest(input: unknown): string {
  return createHash("sha256").update(canonicalPackJson(input), "utf8").digest("hex");
}

function issue(into: PackCompileIssue[], code: string, path: string, message: string): void {
  into.push({ code, path, message });
}

function exactKeys(value: ObjectMap, allowed: readonly string[], path: string, errors: PackCompileIssue[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) issue(errors, "unknown_field", path + "." + key, "Field is not part of the authoring contract.");
  }
}

function safeJson(value: unknown, errors: PackCompileIssue[], path = "$", depth = 0): void {
  if (depth > 24) { issue(errors, "unsafe_depth", path, "Maximum nesting depth exceeded."); return; }
  if (Array.isArray(value)) {
    if (value.length > 10000) issue(errors, "unsafe_size", path, "Array too large.");
    for (let i = 0; i < value.length; i++) safeJson(value[i], errors, path + "[" + i + "]", depth + 1);
  } else if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 300) issue(errors, "unsafe_size", path, "Object too large.");
    for (const key of keys) {
      if (["__proto__", "constructor", "prototype"].includes(key)) {
        issue(errors, "unsafe_key", path + "." + key, "Prototype mutation keys are prohibited.");
      } else {
        safeJson(value[key], errors, path + "." + key, depth + 1);
      }
    }
  } else if (typeof value === "string") {
    if (value.length > 20000) issue(errors, "unsafe_size", path, "String too long.");
  } else if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
    return;
  } else {
    issue(errors, "unsafe_value", path, "Only finite JSON values are allowed; executable content is prohibited.");
  }
}

function validatePredicate(raw: unknown, path: string, errors: PackCompileIssue[], depth = 0): void {
  if (!isObject(raw) || depth > 10) {
    issue(errors, "predicate_invalid", path, "Expected a bounded typed predicate.");
    return;
  }
  switch (raw.op) {
    case "REVIEW_REQUIRED":
      exactKeys(raw, ["op"], path, errors);
      return;
    case "FIELD_PRESENT":
      exactKeys(raw, ["op", "entityId", "fieldId"], path, errors);
      if (!nonempty(raw.entityId) || !nonempty(raw.fieldId)) issue(errors, "predicate_binding", path, "Entity and field IDs required.");
      return;
    case "DOCUMENT_PRESENT":
      exactKeys(raw, ["op", "documentKindId"], path, errors);
      if (!nonempty(raw.documentKindId)) issue(errors, "predicate_binding", path, "Document kind ID required.");
      return;
    case "ALL":
    case "ANY":
      exactKeys(raw, ["op", "conditions"], path, errors);
      if (!Array.isArray(raw.conditions) || raw.conditions.length < 1 || raw.conditions.length > 32) {
        issue(errors, "predicate_children", path, "Expected 1–32 child predicates.");
      } else raw.conditions.forEach((v, i) => validatePredicate(v, path + ".conditions[" + i + "]", errors, depth + 1));
      return;
    case "NOT":
      exactKeys(raw, ["op", "condition"], path, errors);
      validatePredicate(raw.condition, path + ".condition", errors, depth + 1);
      return;
    case "COMPARE":
      exactKeys(raw, ["op", "left", "comparator", "right"], path, errors);
      if (!nonempty(raw.left) || !nonempty(raw.right) ||
          !["EQ", "NE", "LT", "LTE", "GT", "GTE"].includes(String(raw.comparator))) {
        issue(errors, "predicate_comparison", path, "Invalid typed comparison.");
      }
      return;
    default:
      issue(errors, "predicate_operator", path, "Unsupported predicate operator.");
  }
}

function validateDefinition(raw: unknown, path: string, errors: PackCompileIssue[]): raw is PackDefinition {
  if (!isObject(raw)) { issue(errors, "definition_invalid", path, "Definition must be an object."); return false; }
  if (!nonempty(raw.id) || !ID.test(raw.id) || !nonempty(raw.label) || !VALID_KINDS.has(String(raw.kind))) {
    issue(errors, "definition_identity", path, "A stable ID, label, and supported kind are required.");
    return false;
  }
  exactKeys(raw, ["id", "kind", "label", "authority", ...DEFINITION_KEYS[String(raw.kind)]], path, errors);
  if (raw.authority !== undefined) {
    const a = raw.authority;
    if (!isObject(a) || !["REGULATION","CASE_LAW","PROFESSIONAL_PRACTICE","FIRM_POLICY","REFERENCE","OBSERVATION"].includes(String(a.kind)) || !nonempty(a.citation)) {
      issue(errors, "authority_invalid", path + ".authority", "Authority kind and citation are required.");
    } else {
      exactKeys(a, ["kind", "citation", "reviewedBy", "reviewedAt"], path + ".authority", errors);
      if (["REGULATION","CASE_LAW"].includes(String(a.kind)) &&
          (!nonempty(a.reviewedBy) || !validDate(a.reviewedAt))) {
        issue(errors, "authority_review_missing", path + ".authority", "Legal authority requires reviewer and review date.");
      }
    }
  }
  const a = (v: unknown): v is unknown[] => Array.isArray(v);
  const strArray = (v: unknown): v is string[] => a(v) && v.every((e) => nonempty(e));
  switch (raw.kind) {
    case "entity":
      if (!a(raw.fields) || !raw.fields.every((f) => isObject(f) && nonempty(f.id) && ID.test(f.id) &&
        ["TEXT","NUMBER","DATE","BOOLEAN","MONEY","QUANTITY"].includes(String(f.valueType)) &&
        (f.required === undefined || typeof f.required === "boolean") &&
        (f.unit === undefined || nonempty(f.unit)))) issue(errors, "entity_fields", path, "Invalid typed fields.");
      else {
        raw.fields.forEach((f, i) => exactKeys(f as ObjectMap, ["id","valueType","required","unit"], path + ".fields[" + i + "]", errors));
        if (!unique(raw.fields.map((f) => (f as {id:string}).id))) issue(errors, "duplicate_field", path, "Duplicate attribute ID.");
      }
      break;
    case "relationship":
      if (!nonempty(raw.fromEntityId) || !nonempty(raw.toEntityId) || typeof raw.evidenceRequired !== "boolean")
        issue(errors, "relationship_fields", path, "Endpoints and evidence policy required.");
      break;
    case "document":
      if (!strArray(raw.aliases) || !strArray(raw.settlesCheckIds)) issue(errors, "document_fields", path, "Aliases and check references must be arrays.");
      validatePredicate(raw.appliesWhen, path + ".appliesWhen", errors);
      if (raw.timingDescription !== undefined && typeof raw.timingDescription !== "string") issue(errors,"document_timing",path,"Invalid timing description.");
      if (raw.applicabilityDescription !== undefined && typeof raw.applicabilityDescription !== "string") issue(errors,"document_applicability",path,"Invalid applicability description.");
      break;
    case "check":
      validatePredicate(raw.criterion, path + ".criterion", errors);
      if (raw.question !== undefined && !nonempty(raw.question)) issue(errors, "check_question", path, "Question must be nonblank.");
      break;
    case "calculation":
      if (!(PACK_CALCULATION_OPERATORS as readonly unknown[]).includes(raw.operator) ||
          !strArray(raw.inputFields) || !["EXECUTABLE", "DECLARATION_ONLY"].includes(String(raw.state)) ||
          (raw.state === "EXECUTABLE" && raw.inputFields.length === 0) ||
          (raw.state === "DECLARATION_ONLY" && !nonempty(raw.legacyInputs))) {
        issue(errors, "calculation_invalid", path, "Unsupported operator or incomplete calculation bindings.");
      }
      if (raw.scope !== undefined && typeof raw.scope !== "string") issue(errors,"calculation_scope",path,"Invalid calculation scope.");
      break;
    case "chain":
      if (!strArray(raw.links) || raw.links.length === 0) issue(errors, "chain_invalid", path, "At least one link is required.");
      break;
    case "question":
      if (!["customer","professional","all"].includes(String(raw.audience)) || !nonempty(raw.text))
        issue(errors, "question_invalid", path, "Audience and question required.");
      validatePredicate(raw.appliesWhen, path + ".appliesWhen", errors);
      if (raw.conditionDescription !== undefined && typeof raw.conditionDescription !== "string") issue(errors,"question_condition",path,"Invalid condition description.");
      if (raw.rationale !== undefined && typeof raw.rationale !== "string") issue(errors,"question_rationale",path,"Invalid rationale.");
      break;
    case "workflow":
      if (!a(raw.steps) || !raw.steps.every((s) => isObject(s) && nonempty(s.id) &&
          (PACK_WORKFLOW_ACTIONS as readonly unknown[]).includes(s.action) && typeof s.requiresReview === "boolean")) {
        issue(errors, "workflow_unsafe_action", path, "Only allowlisted, review-controlled actions are permitted.");
      } else raw.steps.forEach((s, i) => exactKeys(s as ObjectMap, ["id","action","requiresReview"], path + ".steps[" + i + "]", errors));
      break;
    case "report":
      if (!["customer","professional"].includes(String(raw.audience)) || !a(raw.sections) ||
          !raw.sections.every((s) => isObject(s) && nonempty(s.id) && nonempty(s.heading) && strArray(s.blocks) &&
            s.blocks.every((b: string) => BLOCKS.has(b)) &&
            (s.templateDescription === undefined || typeof s.templateDescription === "string"))) issue(errors, "report_invalid", path, "Report sections must use allowlisted blocks.");
      else raw.sections.forEach((s, i) => exactKeys(s as ObjectMap, ["id","heading","blocks","templateDescription"], path + ".sections[" + i + "]", errors));
      if (raw.voice !== undefined && typeof raw.voice !== "string") issue(errors,"report_voice",path,"Invalid report voice.");
      break;
    case "term":
      if (!nonempty(raw.meaning)) issue(errors, "term_invalid", path, "Meaning required.");
      break;
    case "referenceTable":
      if (!strArray(raw.columns) || !a(raw.rows) || !raw.rows.every((row) => a(row) &&
          row.length === (raw.columns as string[]).length && row.every((cell) => typeof cell === "string")))
        issue(errors, "reference_table_invalid", path, "Rows must match declared columns.");
      break;
    case "persona":
      if (!["customer","professional"].includes(String(raw.audience)) ||
          !nonempty(raw.context) || !strArray(raw.questionIds)) issue(errors, "persona_invalid", path, "Persona requires audience, context and question IDs.");
      for (const key of ["knows","doesNotKnow","decisions","usefulWhen","leaveOut","successTest"]) {
        if (raw[key] !== undefined && typeof raw[key] !== "string") issue(errors,"persona_profile",path+"."+key,"Invalid profile text.");
      }
      break;
    case "note":
      if (!nonempty(raw.text) || !nonempty(raw.showWhen)) issue(errors, "note_invalid", path, "Note text and condition required.");
      break;
    case "guideline":
      if (!nonempty(raw.text) || !["GENERAL","INVESTIGATION","REPORTING"].includes(String(raw.scope)))
        issue(errors,"guideline_invalid",path,"Guideline text and scope required.");
      break;
  }
  return true;
}

function validateReferences(defs: readonly EffectiveDefinition[], errors: PackCompileIssue[]): void {
  const byId = new Map(defs.map((d) => [d.id, d]));
  for (const def of defs) {
    if (def.kind === "relationship") {
      if (byId.get(def.fromEntityId)?.kind !== "entity" || byId.get(def.toEntityId)?.kind !== "entity")
        issue(errors, "relationship_target_missing", def.id, "Both endpoints must name effective entities.");
    }
    if (def.kind === "document") for (const id of def.settlesCheckIds) {
      if (byId.get(id)?.kind !== "check") issue(errors, "check_target_missing", def.id, "Document settles an unknown check: " + id);
    }
    if (def.kind === "persona") for (const id of def.questionIds) {
      if (byId.get(id)?.kind !== "question") issue(errors, "question_target_missing", def.id, "Persona references unknown question: " + id);
    }
    if (def.kind === "check" || def.kind === "document" || def.kind === "question") {
      const p: PackPredicate = def.kind === "check" ? def.criterion : def.appliesWhen;
      function refs(node: PackPredicate): void {
        if (node.op === "FIELD_PRESENT") {
          const entity = byId.get(node.entityId);
          if (entity?.kind !== "entity" || !entity.fields.some((f) => f.id === node.fieldId))
            issue(errors, "predicate_target_missing", def.id, "Unknown entity field binding.");
        } else if (node.op === "DOCUMENT_PRESENT") {
          if (byId.get(node.documentKindId)?.kind !== "document")
            issue(errors, "predicate_target_missing", def.id, "Unknown document kind binding.");
        } else if (node.op === "ALL" || node.op === "ANY") node.conditions.forEach(refs);
        else if (node.op === "NOT") refs(node.condition);
      }
      refs(p);
    }
  }
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Compiles one immutable effective snapshot. A derived edition may have one
 * exact digest-pinned upstream; no floating/latest lookup or implicit rebase.
 * Caller must enforce edit/publish permissions separately: ownership in a
 * submitted file is an assertion, not authorization.
 */
export function compileDomainPack(raw: unknown, upstream?: CompiledDomainPack): PackCompileResult {
  const errors: PackCompileIssue[] = [];
  safeJson(raw, errors);
  if (!isObject(raw)) return { ok: false, issues: errors.concat([{code:"source_invalid",path:"$",message:"Expected an object."}]) };
  exactKeys(raw, ["schema","identity","ownership","applicability","upstream","definitions","changes","review"], "$", errors);
  if (raw.schema !== DOMAIN_PACK_SOURCE_SCHEMA) issue(errors, "schema_invalid", "$.schema", "Unsupported authoring schema.");
  const identity = raw.identity;
  if (!isObject(identity) || !nonempty(identity.packId) || !ID.test(identity.packId) ||
      !nonempty(identity.version) || !VERSION.test(identity.version) || !nonempty(identity.title)) {
    issue(errors, "identity_invalid", "$.identity", "Pack ID, semantic version and title required.");
  } else exactKeys(identity, ["packId","version","title","description"], "$.identity", errors);
  const owner = raw.ownership;
  if (!isObject(owner) || !["PLATFORM","PRO","FIRM"].includes(String(owner.scope)) ||
      !nonempty(owner.ownerId) || !nonempty(owner.authoredBy)) issue(errors, "ownership_invalid", "$.ownership", "Owner scope, ID and author required.");
  else exactKeys(owner, ["scope","ownerId","authoredBy"], "$.ownership", errors);
  const applicability = raw.applicability;
  if (!isObject(applicability) || !nonempty(applicability.jurisdiction) ||
      !["REVIEWED","UNVERIFIED"].includes(String(applicability.verification))) {
    issue(errors, "applicability_invalid", "$.applicability", "Jurisdiction and review state required.");
  } else {
    exactKeys(applicability, ["jurisdiction","verification","effectiveFrom","effectiveTo","intentHints","documentHints"], "$.applicability", errors);
    if ((applicability.effectiveFrom !== undefined && !validDate(applicability.effectiveFrom)) ||
        (applicability.effectiveTo !== undefined && !validDate(applicability.effectiveTo)) ||
        (validDate(applicability.effectiveFrom) && validDate(applicability.effectiveTo) &&
          String(applicability.effectiveFrom) > String(applicability.effectiveTo))) {
      issue(errors, "applicability_dates", "$.applicability", "Invalid effective date interval.");
    }
    if ((applicability.intentHints !== undefined && (!Array.isArray(applicability.intentHints) || !applicability.intentHints.every(nonempty))) ||
        (applicability.documentHints !== undefined && (!Array.isArray(applicability.documentHints) || !applicability.documentHints.every(nonempty)))) {
      issue(errors, "applicability_hints", "$.applicability", "Match hints must be nonempty strings.");
    }
  }
  const review = raw.review;
  if (!isObject(review) || !["DRAFT","REVIEWED"].includes(String(review.status))) {
    issue(errors, "review_invalid", "$.review", "Review status required.");
  } else {
    exactKeys(review, ["status","reviewerId","reviewedAt"], "$.review", errors);
    if (review.status === "REVIEWED" && (!nonempty(review.reviewerId) || !validDate(review.reviewedAt)))
      issue(errors, "review_missing", "$.review", "Reviewed editions require a reviewer and date.");
  }
  if (!Array.isArray(raw.definitions) || !Array.isArray(raw.changes))
    issue(errors, "definitions_invalid", "$", "Definitions and edits must be arrays.");
  if (Array.isArray(raw.definitions)) raw.definitions.forEach((d, i) => validateDefinition(d, "$.definitions[" + i + "]", errors));

  const base = raw.upstream;
  if (base !== undefined) {
    if (!isObject(base) || !nonempty(base.packId) || !nonempty(base.version) ||
        !VERSION.test(base.version) || !nonempty(base.digest) || !DIGEST.test(base.digest)) {
      issue(errors, "upstream_ref_invalid", "$.upstream", "Pinned upstream ID, version and SHA-256 required.");
    } else {
      exactKeys(base, ["packId","version","digest"], "$.upstream", errors);
      if (!upstream || upstream.identity.packId !== base.packId ||
          upstream.identity.version !== base.version || upstream.identity.digest !== base.digest) {
        issue(errors, "upstream_digest_mismatch", "$.upstream", "The precise immutable upstream artifact was not provided.");
      }
      if (identity && isObject(identity) && identity.packId === base.packId)
        issue(errors, "edition_identity_conflict", "$.identity.packId", "Derived edition must have its own Pack ID.");
    }
    if (Array.isArray(raw.definitions) && raw.definitions.length > 0)
      issue(errors, "derived_definitions", "$.definitions", "Derived editions may only use ID-addressed changes.");
  } else if (upstream) {
    issue(errors, "unexpected_upstream", "$.upstream", "Source does not declare the provided base.");
  } else if (Array.isArray(raw.changes) && raw.changes.length > 0) {
    issue(errors, "independent_changes", "$.changes", "Independent source must declare definitions directly.");
  }

  if (Array.isArray(raw.changes)) raw.changes.forEach((change, i) => {
    const path = "$.changes[" + i + "]";
    if (!isObject(change) || !["add","replace","supersede","disable"].includes(String(change.op)) ||
        !nonempty(change.definitionId) || !ID.test(change.definitionId) || !nonempty(change.reason)) {
      issue(errors, "change_invalid", path, "Edit requires operation, stable definition ID and reason.");
      return;
    }
    exactKeys(change, change.op === "disable" ? ["op","definitionId","reason"] : ["op","definitionId","reason","definition"], path, errors);
    if (change.op !== "disable") {
      if (validateDefinition(change.definition, path + ".definition", errors) &&
          (change.definition as PackDefinition).id !== change.definitionId)
        issue(errors, "change_id_mismatch", path, "Edited definition ID must match its target ID.");
    }
  });
  if (errors.length) return { ok: false, issues: errors };

  const source = raw as unknown as DomainPackSource;
  const definitions = new Map<string, EffectiveDefinition>();
  const disabled = new Set<string>(upstream?.disabledDefinitionIds ?? []);
  if (upstream) for (const d of upstream.definitions) definitions.set(d.id, structuredClone(d));
  else for (const d of source.definitions) {
    if (definitions.has(d.id)) issue(errors, "duplicate_definition", d.id, "Duplicate stable definition ID.");
    definitions.set(d.id, { ...structuredClone(d), origin: {packId:source.identity.packId,version:source.identity.version,operation:"base"} });
  }
  const touched = new Set<string>();
  for (const edit of source.changes) {
    if (touched.has(edit.definitionId)) issue(errors, "multiple_edits", edit.definitionId, "Only one edit per stable ID in an edition.");
    touched.add(edit.definitionId);
    const prior = definitions.get(edit.definitionId);
    if (edit.op === "add" && (prior || disabled.has(edit.definitionId)))
      issue(errors, "edit_conflict", edit.definitionId, "Cannot add an existing/disabled definition.");
    if (edit.op !== "add" && !prior)
      issue(errors, "edit_target_missing", edit.definitionId, "Edit target is absent from the upstream snapshot.");
    if (edit.op !== "disable") {
      if (prior && prior.kind !== edit.definition.kind)
        issue(errors, "edit_type_change", edit.definitionId, "A stable definition cannot change kind.");
      definitions.set(edit.definitionId, {
        ...structuredClone(edit.definition),
        origin: {packId:source.identity.packId,version:source.identity.version,operation:edit.op,reason:edit.reason},
      });
    } else if (prior) {
      definitions.delete(edit.definitionId);
      disabled.add(edit.definitionId);
    }
  }
  if (errors.length) return { ok: false, issues: errors };
  const effective = [...definitions.values()].sort((a,b)=>a.id.localeCompare(b.id,"en"));
  validateReferences(effective, errors);
  if (errors.length) return { ok: false, issues: errors };
  const material = {
    schema: DOMAIN_PACK_RUNTIME_SCHEMA,
    compilerVersion: DOMAIN_PACK_COMPILER_VERSION,
    identity: source.identity,
    ownership: source.ownership,
    applicability: source.applicability,
    ...(source.upstream ? {upstream:source.upstream} : {}),
    publication: "UNPUBLISHED" as const,
    review: source.review,
    definitions: effective,
    disabledDefinitionIds: [...disabled].sort(),
    editHistory: [...(upstream?.editHistory ?? []), ...source.changes],
  };
  return {ok:true,value:freezeDeep({
    ...material,
    identity: {...source.identity,digest:packDigest(material)},
  })};
}
