/**
 * Compiles one immutable effective Domain Pack from a base edition and ordered extensions.
 * Extensions inherit applicability. A `when` expression only narrows it.
 * Broadening, and any Pro or Firm edit to a core authority or evidence rule, fails closed.
 * A caller-supplied compiled digest is not proof of the snapshot. Each edition is recompiled
 * and rejected when its contents or digest differ. Publication and authorization stay separate.
 * This module does not call a model, publish a pack, or accept a Study.
 */
import {
  ALWAYS_APPLICABLE,
  canonicalizeApplicabilityExpr,
  evaluateApplicability,
  parseApplicabilityExpr,
  parseCaseAttribute,
  type ApplicabilityExpr,
  type ApplicabilityIssue,
  type ApplicabilityResult,
  type CaseAttribute,
} from "./applicability-expression";
import { canonicalPackJson, compileDomainPack, packDigest } from "./domain-pack-compiler";
import {
  DOMAIN_PACK_COMPILER_VERSION,
  DOMAIN_PACK_RUNTIME_SCHEMA,
  DOMAIN_PACK_SOURCE_SCHEMA,
  type CompiledDomainPack,
  type DomainPackSource,
  type EffectiveDefinition,
  type PackApplicability,
  type PackDefinition,
  type PackEdit,
  type PackOwner,
} from "./domain-pack-source";

export const EFFECTIVE_DOMAIN_PACK_SCHEMA = "hive.effective-domain-pack/1" as const;

export type { ApplicabilityExpr, ApplicabilityResult, CaseAttribute };

const ID = /^[A-Za-z][A-Za-z0-9._:/-]{0,127}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const DIGEST = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LAYER_RANK = { PLATFORM: 0, PRO: 1, FIRM: 2 } as const;
const LAYER_ROLES = ["BASE", "PLATFORM", "PRO", "FIRM"] as const;

export type StudyContractIssue = { code: string; path: string; message: string };
export type StudyContractResult<T> = { ok: true; value: T } | { ok: false; issues: StudyContractIssue[] };

export type PackLayerRole = (typeof LAYER_ROLES)[number];

export type PackLayerRef = {
  role: PackLayerRole;
  packId: string;
  version: string;
  digest: string;
  ownership: PackOwner;
};

export type ClauseOrigin = {
  packId: string;
  version: string;
  operation: "base" | "add" | "replace" | "supersede";
  reason?: string;
  layerRole: PackLayerRole;
};

export type ClauseProvenance = ClauseOrigin & {
  definitionId: string;
  prior?: ClauseOrigin[];
};

export type ClauseExpression = {
  definitionId: string;
  expression: ApplicabilityExpr;
};

export type DisabledClause = { definitionId: string; reason: string };

export type ApplicabilityDecision = {
  packId: string;
  version: string;
  digest: string;
  role: PackLayerRole;
  result: ApplicabilityResult;
  included: boolean;
  expression: ApplicabilityExpr;
};

export type EffectiveDomainPack = {
  schema: typeof EFFECTIVE_DOMAIN_PACK_SCHEMA;
  digest: string;
  definitionsDigest: string;
  publication: "UNPUBLISHED";
  layers: PackLayerRef[];
  decisions: ApplicabilityDecision[];
  applicability: PackApplicability;
  attributes: CaseAttribute[];
  definitions: EffectiveDefinition[];
  provenance: ClauseProvenance[];
  clauseExpressions: ClauseExpression[];
  disabled: DisabledClause[];
};

export type ExtensionAuthorization = {
  actorScope: "PLATFORM" | "PRO" | "FIRM";
  actorId: string;
  grant?: "PRO" | "FIRM";
  reason?: string;
};

export type EffectiveExtensionInput = {
  pack: CompiledDomainPack;
  when?: ApplicabilityExpr;
  broaden?: { expression: ApplicabilityExpr; reason: string };
  authorization: ExtensionAuthorization;
};

export type CompileEffectiveDomainPackInput = {
  base: CompiledDomainPack;
  when?: ApplicabilityExpr;
  extensions?: readonly EffectiveExtensionInput[];
  attributes?: readonly CaseAttribute[];
  clauseExpressions?: readonly { definitionId: string; expression: ApplicabilityExpr }[];
};

type ObjectMap = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectMap => !!value && typeof value === "object" && !Array.isArray(value);

function issue(into: StudyContractIssue[], code: string, path: string, message: string): void {
  into.push({ code, path, message });
}

function finish<T>(issues: StudyContractIssue[], value: T): StudyContractResult<T> {
  if (issues.length > 0) {
    const sorted = [...issues].sort((left, right) => (left.path + "\0" + left.code).localeCompare(right.path + "\0" + right.code));
    return { ok: false, issues: sorted };
  }
  return { ok: true, value: freezeDeep(value) };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value: ObjectMap, allowed: readonly string[], path: string, issues: StudyContractIssue[]): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) issue(issues, "unknown_field", path + "." + key, "Field is not part of this contract.");
  }
}

function adopt(into: StudyContractIssue[], items: readonly ApplicabilityIssue[]): void {
  for (const item of items) into.push(item);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function validDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function readCaseAttributes(raw: unknown, path: string, issues: StudyContractIssue[]): CaseAttribute[] | null {
  if (!Array.isArray(raw)) {
    issue(issues, "attributes_invalid", path, "Attributes must be an array.");
    return null;
  }
  if (raw.length > 32) issue(issues, "attributes_invalid", path, "Too many attributes.");
  const attributes: CaseAttribute[] = [];
  raw.forEach((item, index) => {
    const local: ApplicabilityIssue[] = [];
    const attribute = parseCaseAttribute(item, path + "[" + index + "]", local);
    adopt(issues, local);
    if (attribute) attributes.push(attribute);
  });
  if (issues.some((item) => item.path.startsWith(path))) return null;
  const keys = attributes.map((attribute) => attribute.key);
  if (new Set(keys).size !== keys.length) {
    issue(issues, "duplicate_attribute", path, "Attribute keys must be unique.");
    return null;
  }
  return [...attributes].sort((left, right) => left.key.localeCompare(right.key));
}

function readExpression(raw: unknown, path: string, issues: StudyContractIssue[]): ApplicabilityExpr | null {
  const local: ApplicabilityIssue[] = [];
  const expression = parseApplicabilityExpr(raw, path, local);
  adopt(issues, local);
  return expression;
}

function readOwner(raw: unknown, path: string, issues: StudyContractIssue[]): PackOwner | null {
  if (!isObject(raw)) {
    issue(issues, "ownership_invalid", path, "Ownership must be an object.");
    return null;
  }
  exactKeys(raw, ["scope", "ownerId", "authoredBy"], path, issues);
  if (raw.scope !== "PLATFORM" && raw.scope !== "PRO" && raw.scope !== "FIRM") {
    issue(issues, "ownership_invalid", path + ".scope", "Owner scope is not recognized.");
  }
  if (typeof raw.ownerId !== "string" || raw.ownerId.trim() === "" || raw.ownerId.length > 200) {
    issue(issues, "ownership_invalid", path + ".ownerId", "Owner id is required.");
  }
  if (typeof raw.authoredBy !== "string" || raw.authoredBy.trim() === "" || raw.authoredBy.length > 200) {
    issue(issues, "ownership_invalid", path + ".authoredBy", "Author is required.");
  }
  if (issues.some((item) => item.path.startsWith(path))) return null;
  return { scope: raw.scope as PackOwner["scope"], ownerId: raw.ownerId as string, authoredBy: raw.authoredBy as string };
}

function compiledPack(raw: unknown, path: string, issues: StudyContractIssue[]): CompiledDomainPack | null {
  // Shape only. The digest string is not evidence that these fields were compiled.
  if (!isObject(raw) || raw.schema !== DOMAIN_PACK_RUNTIME_SCHEMA || !isObject(raw.identity) || !isObject(raw.ownership)) {
    issue(issues, "pack_invalid", path, "Expected a compiled Domain Pack snapshot.");
    return null;
  }
  const identity = raw.identity;
  if (!validId(identity.packId) || typeof identity.version !== "string" || !VERSION.test(identity.version) || !validDigest(identity.digest)) {
    issue(issues, "pack_identity", path + ".identity", "Compiled pack id, version, and digest are required.");
    return null;
  }
  if (raw.publication !== "UNPUBLISHED") {
    issue(issues, "pack_publication", path + ".publication", "A compiled snapshot is unpublished. An extension cannot grant publication.");
    return null;
  }
  if (!readOwner(raw.ownership, path + ".ownership", issues)) return null;
  if (!Array.isArray(raw.definitions) || !Array.isArray(raw.disabledDefinitionIds) || !Array.isArray(raw.editHistory) || !isObject(raw.applicability)) {
    issue(issues, "pack_invalid", path, "Compiled definitions, applicability, and edit history are required.");
    return null;
  }
  return raw as unknown as CompiledDomainPack;
}

function authorizationOk(auth: ExtensionAuthorization | undefined, ownership: PackOwner, path: string, issues: StudyContractIssue[]): boolean {
  if (!auth || (auth.actorScope !== "PLATFORM" && auth.actorScope !== "PRO" && auth.actorScope !== "FIRM") ||
      typeof auth.actorId !== "string" || auth.actorId.trim() === "" || auth.actorId.length > 200) {
    issue(issues, "authorization_invalid", path, "Authorization needs an actor scope and actor id.");
    return false;
  }
  if (auth.grant !== undefined && auth.grant !== "PRO" && auth.grant !== "FIRM") {
    issue(issues, "authorization_invalid", path + ".grant", "A grant is PRO or FIRM.");
    return false;
  }
  if (auth.reason !== undefined && (typeof auth.reason !== "string" || auth.reason.trim() === "" || auth.reason.length > 500)) {
    issue(issues, "authorization_invalid", path + ".reason", "Authorization reason must be short text.");
    return false;
  }
  const ownerMatch = auth.actorScope === ownership.scope && auth.actorId === ownership.ownerId && auth.grant === undefined;
  const platformGrant = auth.actorScope === "PLATFORM" && auth.grant === ownership.scope && typeof auth.reason === "string";
  if (!ownerMatch && !platformGrant) {
    issue(issues, "unauthorized_extension", path, "This actor is not authorized to apply the extension.");
    return false;
  }
  return true;
}

function applicabilityWidens(parent: PackApplicability, child: PackApplicability): boolean {
  if (child.jurisdiction !== parent.jurisdiction) return true;
  if (parent.verification === "UNVERIFIED" && child.verification === "REVIEWED") return true;
  if (parent.effectiveFrom && (!child.effectiveFrom || child.effectiveFrom < parent.effectiveFrom)) return true;
  if (parent.effectiveTo && (!child.effectiveTo || child.effectiveTo > parent.effectiveTo)) return true;
  return false;
}

function laterDate(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function earlierDate(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function intersectApplicability(parent: PackApplicability, child: PackApplicability): PackApplicability | null {
  const effectiveFrom = laterDate(parent.effectiveFrom, child.effectiveFrom);
  const effectiveTo = earlierDate(parent.effectiveTo, child.effectiveTo);
  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) return null;
  const verification = parent.verification === "UNVERIFIED" || child.verification === "UNVERIFIED" ? "UNVERIFIED" : "REVIEWED";
  return {
    jurisdiction: parent.jurisdiction,
    verification,
    ...(effectiveFrom ? { effectiveFrom } : {}),
    ...(effectiveTo ? { effectiveTo } : {}),
    ...(parent.intentHints ? { intentHints: [...parent.intentHints] } : {}),
    ...(parent.documentHints ? { documentHints: [...parent.documentHints] } : {}),
  };
}

function ancestorDigests(pack: CompiledDomainPack, byDigest: ReadonlyMap<string, CompiledDomainPack>): Set<string> {
  const ancestors = new Set<string>();
  let current: CompiledDomainPack | undefined = pack;
  const seen = new Set<string>();
  while (current?.upstream && !seen.has(current.identity.digest)) {
    seen.add(current.identity.digest);
    const parent = byDigest.get(current.upstream.digest);
    if (!parent) break;
    ancestors.add(parent.identity.digest);
    current = parent;
  }
  return ancestors;
}

function ownEdits(extension: CompiledDomainPack, parent: CompiledDomainPack, path: string, issues: StudyContractIssue[]): PackEdit[] | null {
  const history = extension.editHistory;
  const prior = parent.editHistory;
  if (history.length < prior.length) {
    issue(issues, "lineage_mismatch", path, "Extension history does not continue its pinned parent.");
    return null;
  }
  for (let index = 0; index < prior.length; index += 1) {
    if (canonicalPackJson(history[index]) !== canonicalPackJson(prior[index])) {
      issue(issues, "lineage_mismatch", path, "Extension history does not continue its pinned parent.");
      return null;
    }
  }
  const edits = history.slice(prior.length);
  const seen = new Set<string>();
  let duplicate = false;
  for (const edit of edits) {
    if (!edit || !["add", "replace", "supersede", "disable"].includes(edit.op) || !validId(edit.definitionId)) {
      issue(issues, "change_invalid", path, "Extension edit is not a supported pack edit.");
      return null;
    }
    if (seen.has(edit.definitionId)) {
      issue(issues, "multiple_edits", edit.definitionId, "Only one edit per definition in an extension.");
      duplicate = true;
    }
    seen.add(edit.definitionId);
  }
  return duplicate ? null : edits;
}

function weakensCore(prior: EffectiveDefinition, edit: PackEdit): boolean {
  if (prior.kind === "relationship" && prior.evidenceRequired) {
    if (edit.op === "disable") return true;
    if (edit.definition.kind === "relationship" && edit.definition.evidenceRequired === false) return true;
  }
  if (prior.kind === "workflow" && prior.steps.some((step) => step.requiresReview)) {
    if (edit.op === "disable") return true;
    if (edit.definition.kind === "workflow") {
      const required = new Map(prior.steps.map((step) => [step.id, step.requiresReview]));
      if (edit.definition.steps.some((step) => required.get(step.id) === true && step.requiresReview === false)) return true;
    }
  }
  return false;
}

function unauthorizedOverride(scope: PackOwner["scope"], prior: EffectiveDefinition | undefined, edit: PackEdit): boolean {
  if (scope === "PLATFORM" || !prior || edit.op === "add") return false;
  const kind = prior.authority?.kind;
  if (kind === "REGULATION" || kind === "CASE_LAW") return true;
  if (kind === "PROFESSIONAL_PRACTICE" && scope !== "PRO") return true;
  return weakensCore(prior, edit);
}

function provenanceFrom(definition: EffectiveDefinition, role: PackLayerRole, previous?: ClauseProvenance): ClauseProvenance {
  const latest: ClauseProvenance = {
    definitionId: definition.id,
    packId: definition.origin.packId,
    version: definition.origin.version,
    operation: definition.origin.operation === "disable" ? "replace" : definition.origin.operation,
    ...(definition.origin.reason ? { reason: definition.origin.reason } : {}),
    layerRole: role,
  };
  if (!previous) return latest;
  const { definitionId: _ignored, prior: older, ...rest } = previous;
  return { ...latest, prior: [...(older ?? []), rest] };
}

function asDefinition(definition: EffectiveDefinition): PackDefinition {
  const { origin: _origin, ...rest } = structuredClone(definition);
  return rest;
}

function authoringIdentity(pack: CompiledDomainPack): DomainPackSource["identity"] {
  const identity: DomainPackSource["identity"] = {
    packId: pack.identity.packId,
    version: pack.identity.version,
    title: pack.identity.title,
  };
  if (pack.identity.description !== undefined) identity.description = pack.identity.description;
  return identity;
}

/** Reconstruct the authoring source a faithful compilation would have used. */
function authoringSource(pack: CompiledDomainPack, parent?: CompiledDomainPack): DomainPackSource {
  const identity = authoringIdentity(pack);
  if (!parent) {
    return {
      schema: DOMAIN_PACK_SOURCE_SCHEMA,
      identity,
      ownership: pack.ownership,
      applicability: pack.applicability,
      definitions: pack.definitions.map(asDefinition),
      changes: [],
      review: pack.review,
    };
  }
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity,
    ownership: pack.ownership,
    applicability: pack.applicability,
    upstream: { packId: parent.identity.packId, version: parent.identity.version, digest: parent.identity.digest },
    definitions: [],
    changes: pack.editHistory.slice(parent.editHistory.length),
    review: pack.review,
  };
}

/**
 * Recompile a snapshot with compileDomainPack. Accept it only when that artifact
 * is the same edition, including the digest already on the snapshot.
 * A mismatch is rejected. The digest is not rewritten to fit the input.
 */
function editionAgrees(pack: CompiledDomainPack, parent: CompiledDomainPack | undefined, path: string, issues: StudyContractIssue[]): boolean {
  if (pack.compilerVersion !== DOMAIN_PACK_COMPILER_VERSION || (pack.upstream === undefined) !== (parent === undefined)) {
    issue(issues, "pack_digest_mismatch", path + ".identity.digest", "Compiled digest does not match the edition source.");
    return false;
  }
  if (parent && pack.upstream && (
    pack.upstream.packId !== parent.identity.packId ||
    pack.upstream.version !== parent.identity.version ||
    pack.upstream.digest !== parent.identity.digest
  )) {
    issue(issues, "upstream_digest_mismatch", path + ".upstream", "An extension must pin the provided parent edition.");
    return false;
  }
  const compiled = compileDomainPack(authoringSource(pack, parent), parent);
  const sameEdition = compiled.ok &&
    compiled.value.identity.digest === pack.identity.digest &&
    canonicalPackJson(compiled.value) === canonicalPackJson(pack);
  if (!sameEdition) {
    issue(issues, "pack_digest_mismatch", path + ".identity.digest", "Compiled digest does not match the edition source.");
    return false;
  }
  return true;
}

function referenceIssues(definitions: readonly EffectiveDefinition[], applicability: PackApplicability): StudyContractIssue[] {
  const result = compileDomainPack({
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: "effective-reference-check", version: "0.0.0", title: "Reference check" },
    ownership: { scope: "PLATFORM", ownerId: "platform", authoredBy: "effective-compiler" },
    applicability,
    definitions: definitions.map(asDefinition),
    changes: [],
    review: { status: "DRAFT" },
  });
  if (result.ok) return [];
  return result.issues.map((item) => ({ code: "invalid_dependency", path: item.path, message: item.message }));
}

function packDigestBody(pack: Omit<EffectiveDomainPack, "digest">): unknown {
  return {
    schema: pack.schema,
    publication: pack.publication,
    layers: pack.layers.map((layer) => ({
      role: layer.role,
      packId: layer.packId,
      version: layer.version,
      digest: layer.digest,
      ownership: layer.ownership,
    })),
    decisions: pack.decisions,
    applicability: pack.applicability,
    attributes: pack.attributes,
    definitionsDigest: pack.definitionsDigest,
    provenance: pack.provenance,
    clauseExpressions: pack.clauseExpressions,
    disabled: pack.disabled,
  };
}

type PreparedExtension = {
  sourceIndex: number;
  pack: CompiledDomainPack;
  role: Exclude<PackLayerRole, "BASE">;
  parent: CompiledDomainPack;
  broadened: boolean;
  replacement?: ApplicabilityExpr;
  narrowing?: ApplicabilityExpr;
};

/**
 * Stack a compiled base and digest-pinned extensions.
 * Candidate order is precedence among equal ranks: Platform, then Pro, then Firm.
 * A FALSE extension is recorded and not applied. UNKNOWN fails the compile.
 */
export function compileEffectiveDomainPack(input: CompileEffectiveDomainPackInput): StudyContractResult<EffectiveDomainPack> {
  const issues: StudyContractIssue[] = [];
  const base = compiledPack(input.base, "$.base", issues);
  const extensionInputs = input.extensions ?? [];
  if (extensionInputs.length > 15) issue(issues, "layers_invalid", "$.extensions", "Too many extensions.");
  const packs = extensionInputs.map((item, index) => compiledPack(item?.pack, "$.extensions[" + index + "].pack", issues));
  if (!base || packs.some((pack) => pack === null)) return finish(issues, undefined as never);
  if (base.upstream) issue(issues, "base_not_root", "$.base", "The base edition is an independent compiled pack.");

  const attributes = readCaseAttributes(input.attributes ?? [], "$.attributes", issues);
  const baseExpression = input.when === undefined ? ALWAYS_APPLICABLE : readExpression(input.when, "$.when", issues);
  if (!attributes || !baseExpression) return finish(issues, undefined as never);

  const byDigest = new Map<string, CompiledDomainPack>();
  if (!base.upstream && editionAgrees(base, undefined, "$.base", issues)) byDigest.set(base.identity.digest, base);
  const identities = new Set<string>([base.identity.packId + "@" + base.identity.version]);
  let lastRank = -1;
  const prepared: PreparedExtension[] = [];
  packs.forEach((pack, index) => {
    if (!pack) return;
    const path = "$.extensions[" + index + "]";
    const source = extensionInputs[index];
    if (!source) return;
    const role = pack.ownership.scope;
    if (LAYER_RANK[role] < lastRank) issue(issues, "precedence_order", path, "Extensions are ordered Platform, then Pro, then Firm.");
    lastRank = LAYER_RANK[role];
    const authorized = authorizationOk(source.authorization, pack.ownership, path + ".authorization", issues);
    if (!pack.upstream) {
      issue(issues, "upstream_digest_mismatch", path, "An extension must pin its parent digest.");
      return;
    }
    const parent = byDigest.get(pack.upstream.digest);
    if (!parent || pack.upstream.packId !== parent.identity.packId || pack.upstream.version !== parent.identity.version || pack.upstream.digest !== parent.identity.digest) {
      issue(issues, "upstream_digest_mismatch", path, "An extension must pin the provided parent edition.");
      return;
    }
    const agreed = editionAgrees(pack, parent, path + ".pack", issues);
    if (!authorized || !agreed) return;
    if (parent.identity.digest !== base.identity.digest && !prepared.some((item) => item.pack.identity.digest === parent.identity.digest)) {
      issue(issues, "upstream_not_included", path, "An extension can pin only the base or an earlier extension.");
    }
    const identity = pack.identity.packId + "@" + pack.identity.version;
    if (identities.has(identity) || pack.identity.packId === parent.identity.packId) {
      issue(issues, "edition_identity_conflict", path, "Each extension needs its own pack id and version.");
    }
    identities.add(identity);
    if (byDigest.has(pack.identity.digest)) issue(issues, "duplicate_layer", path, "Each compiled edition has one digest.");
    byDigest.set(pack.identity.digest, pack);
    const broadened = source.broaden !== undefined;
    if (broadened && source.when !== undefined) issue(issues, "applicability_conflict", path, "An extension narrows or broadens, not both.");
    let replacement: ApplicabilityExpr | undefined;
    let narrowing: ApplicabilityExpr | undefined;
    if (broadened) {
      const reason = source.broaden?.reason;
      if (source.authorization.actorScope !== "PLATFORM" || typeof reason !== "string" || reason.trim() === "" || reason.length > 500) {
        issue(issues, "unauthorized_broaden", path + ".broaden", "Only an authorized platform actor can broaden applicability.");
      }
      replacement = readExpression(source.broaden?.expression, path + ".broaden.expression", issues) ?? undefined;
    } else if (applicabilityWidens(parent.applicability, pack.applicability)) {
      issue(issues, "applicability_broadened", path + ".applicability", "An extension inherits applicability and may only narrow it.");
    }
    if (!broadened && source.when !== undefined) narrowing = readExpression(source.when, path + ".when", issues) ?? undefined;
    prepared.push({ sourceIndex: index, pack, role, parent, broadened, replacement, narrowing });
  });
  if (issues.length > 0 || !attributes || !baseExpression) return finish(issues, undefined as never);

  const attributeMap = new Map(attributes.map((attribute) => [attribute.key, attribute]));
  const baseResult = evaluateApplicability(baseExpression, attributeMap);
  if (!baseResult.ok) return finish([{ code: baseResult.code, path: "$.when", message: baseResult.message }], undefined as never);
  if (baseResult.result === "UNKNOWN") {
    issue(issues, "applicability_unknown", "$.when", "Base applicability is unknown. Missing or unverified attributes do not satisfy it.");
  }
  if (baseResult.result === "FALSE") issue(issues, "base_not_applicable", "$.when", "The base edition does not apply to these attributes.");
  const decisions: ApplicabilityDecision[] = [{
    packId: base.identity.packId,
    version: base.identity.version,
    digest: base.identity.digest,
    role: "BASE",
    result: baseResult.result,
    included: baseResult.result === "TRUE",
    expression: baseExpression,
  }];
  const expressions = new Map<string, ApplicabilityExpr>([[base.identity.digest, baseExpression]]);
  for (const item of prepared) {
    const path = "$.extensions[" + item.sourceIndex + "]";
    const parentExpression = expressions.get(item.parent.identity.digest);
    const parentDecision = decisions.find((decision) => decision.digest === item.parent.identity.digest);
    if (!parentExpression || !parentDecision?.included) {
      issue(issues, "upstream_not_included", path, "The pinned parent is not an included layer.");
      continue;
    }
    let expression = parentExpression;
    if (item.broadened && item.replacement) expression = item.replacement;
    else if (item.narrowing) expression = canonicalizeApplicabilityExpr({ op: "AND", args: [parentExpression, item.narrowing] });
    const evaluated = evaluateApplicability(expression, attributeMap);
    if (!evaluated.ok) {
      issue(issues, evaluated.code, path + ".when", evaluated.message);
      continue;
    }
    if (evaluated.result === "UNKNOWN") {
      issue(issues, "applicability_unknown", path, "Extension applicability is unknown. Missing or unverified attributes do not satisfy it.");
    }
    expressions.set(item.pack.identity.digest, expression);
    decisions.push({
      packId: item.pack.identity.packId,
      version: item.pack.identity.version,
      digest: item.pack.identity.digest,
      role: item.role,
      result: evaluated.result,
      included: evaluated.result === "TRUE",
      expression,
    });
  }
  if (issues.length > 0) return finish(issues, undefined as never);

  const definitions = new Map<string, EffectiveDefinition>();
  const disabled = new Map<string, DisabledClause>();
  const lineage = new Map<string, ClauseProvenance>();
  const editedBy = new Map<string, string>();
  for (const definition of base.definitions) {
    if (definitions.has(definition.id)) issue(issues, "duplicate_definition", definition.id, "Definition ids must be unique.");
    const copy = structuredClone(definition);
    definitions.set(definition.id, copy);
    lineage.set(definition.id, provenanceFrom(copy, "BASE"));
    editedBy.set(definition.id, base.identity.digest);
  }
  for (const definitionId of base.disabledDefinitionIds) {
    const edit = [...base.editHistory].reverse().find((item) => item.op === "disable" && item.definitionId === definitionId);
    if (!edit || edit.reason.trim() === "") issue(issues, "disable_untraced", definitionId, "A disabled clause needs the edit that removed it.");
    else disabled.set(definitionId, { definitionId, reason: edit.reason });
  }

  let applicability = structuredClone(base.applicability);
  const layers: PackLayerRef[] = [{
    role: "BASE",
    packId: base.identity.packId,
    version: base.identity.version,
    digest: base.identity.digest,
    ownership: { ...base.ownership },
  }];
  for (const item of prepared) {
    const decision = decisions.find((entry) => entry.digest === item.pack.identity.digest);
    if (!decision?.included) continue;
    const path = "$.extensions[" + item.sourceIndex + "]";
    const edits = ownEdits(item.pack, item.parent, path, issues);
    if (!edits) continue;
    const ancestors = ancestorDigests(item.pack, byDigest);
    for (const edit of edits) {
      const priorEditor = editedBy.get(edit.definitionId);
      if (priorEditor && !ancestors.has(priorEditor)) {
        issue(issues, "conflicting_edits", edit.definitionId, "Two extensions edit the same clause without a pinned lineage.");
        continue;
      }
      const prior = definitions.get(edit.definitionId);
      if (unauthorizedOverride(item.role, prior, edit)) {
        issue(issues, "unauthorized_override", edit.definitionId, "Pro and Firm extensions cannot override this authority or core requirement.");
        continue;
      }
      if (edit.op === "add") {
        if (prior || disabled.has(edit.definitionId)) {
          issue(issues, "edit_conflict", edit.definitionId, "Cannot add an existing or disabled definition.");
          continue;
        }
        if (edit.definition.id !== edit.definitionId) {
          issue(issues, "change_id_mismatch", edit.definitionId, "Edited definition id must match its target.");
          continue;
        }
      } else if (!prior) {
        issue(issues, "edit_target_missing", edit.definitionId, "Edit target is absent from the included layers.");
        continue;
      } else if (edit.op !== "disable" && prior.kind !== edit.definition.kind) {
        issue(issues, "edit_type_change", edit.definitionId, "A stable definition cannot change kind.");
        continue;
      }
      if (edit.op === "disable") {
        definitions.delete(edit.definitionId);
        lineage.delete(edit.definitionId);
        disabled.set(edit.definitionId, { definitionId: edit.definitionId, reason: edit.reason });
      } else {
        const next: EffectiveDefinition = {
          ...structuredClone(edit.definition),
          origin: { packId: item.pack.identity.packId, version: item.pack.identity.version, operation: edit.op, reason: edit.reason },
        };
        definitions.set(edit.definitionId, next);
        lineage.set(edit.definitionId, provenanceFrom(next, item.role, lineage.get(edit.definitionId)));
        disabled.delete(edit.definitionId);
      }
      editedBy.set(edit.definitionId, item.pack.identity.digest);
    }
    const nextApplicability = item.broadened ? structuredClone(item.pack.applicability) : intersectApplicability(applicability, item.pack.applicability);
    if (!nextApplicability) issue(issues, "applicability_conflict", path, "Included extensions do not share an applicability window.");
    else applicability = nextApplicability;
    layers.push({
      role: item.role,
      packId: item.pack.identity.packId,
      version: item.pack.identity.version,
      digest: item.pack.identity.digest,
      ownership: { ...item.pack.ownership },
    });
  }

  const clauseExpressions: ClauseExpression[] = [];
  const seenClauses = new Set<string>();
  for (const [index, clause] of (input.clauseExpressions ?? []).entries()) {
    const path = "$.clauseExpressions[" + index + "]";
    const expression = readExpression(clause?.expression, path + ".expression", issues);
    if (!clause || !validId(clause.definitionId) || !definitions.has(clause.definitionId) || !expression) {
      issue(issues, "clause_expression", path, "A clause expression must name an effective definition.");
      continue;
    }
    if (seenClauses.has(clause.definitionId)) issue(issues, "duplicate_clause_expression", path, "Each clause has one expression.");
    seenClauses.add(clause.definitionId);
    clauseExpressions.push({ definitionId: clause.definitionId, expression });
  }
  clauseExpressions.sort((left, right) => left.definitionId.localeCompare(right.definitionId));

  const effectiveDefinitions = [...definitions.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (issues.length === 0) issues.push(...referenceIssues(effectiveDefinitions, applicability));
  if (issues.length > 0) return finish(issues, undefined as never);
  const provenance = effectiveDefinitions.map((definition) => lineage.get(definition.id)).filter((item): item is ClauseProvenance => !!item);
  const built: Omit<EffectiveDomainPack, "digest"> = {
    schema: EFFECTIVE_DOMAIN_PACK_SCHEMA,
    definitionsDigest: packDigest(effectiveDefinitions),
    publication: "UNPUBLISHED",
    layers,
    decisions,
    applicability,
    attributes,
    definitions: effectiveDefinitions,
    provenance,
    clauseExpressions,
    disabled: [...disabled.values()].sort((left, right) => left.definitionId.localeCompare(right.definitionId)),
  };
  return parseEffectiveDomainPack({ ...built, digest: packDigest(packDigestBody(built)) });
}

export function composeEffectiveDomainPack(input: CompileEffectiveDomainPackInput): StudyContractResult<EffectiveDomainPack> {
  return compileEffectiveDomainPack(input);
}

function readOrigin(raw: ObjectMap, path: string, issues: StudyContractIssue[], allowDefinitionId: boolean): ClauseOrigin | null {
  if (!validId(raw.packId) || typeof raw.version !== "string" || !VERSION.test(raw.version)) {
    issue(issues, "provenance_invalid", path, "Provenance id and version are required.");
    return null;
  }
  if (raw.operation !== "base" && raw.operation !== "add" && raw.operation !== "replace" && raw.operation !== "supersede") {
    issue(issues, "provenance_invalid", path + ".operation", "Provenance operation is not recognized.");
    return null;
  }
  if (!(LAYER_ROLES as readonly string[]).includes(String(raw.layerRole))) {
    issue(issues, "provenance_invalid", path + ".layerRole", "Provenance layer is not recognized.");
    return null;
  }
  if ((raw.operation === "base") !== (raw.layerRole === "BASE")) {
    issue(issues, "provenance_unresolved", path, "A base origin belongs to the base layer.");
    return null;
  }
  if (raw.reason !== undefined && (typeof raw.reason !== "string" || raw.reason.trim() === "")) {
    issue(issues, "provenance_reason", path + ".reason", "Provenance reason must be text.");
    return null;
  }
  if (raw.operation !== "base" && typeof raw.reason !== "string") {
    issue(issues, "provenance_reason", path + ".reason", "An edited clause needs its reason.");
    return null;
  }
  if (allowDefinitionId && !validId(raw.definitionId)) {
    issue(issues, "provenance_invalid", path + ".definitionId", "Provenance definition id is required.");
    return null;
  }
  return {
    packId: raw.packId,
    version: raw.version,
    operation: raw.operation,
    ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
    layerRole: raw.layerRole as PackLayerRole,
  };
}

export function readClauseProvenance(raw: unknown, path: string, issues: StudyContractIssue[]): ClauseProvenance | null {
  if (!isObject(raw)) {
    issue(issues, "provenance_invalid", path, "Provenance must be an object.");
    return null;
  }
  exactKeys(raw, ["definitionId", "packId", "version", "operation", "reason", "layerRole", "prior"], path, issues);
  const origin = readOrigin(raw, path, issues, true);
  if (!origin || !validId(raw.definitionId)) return null;
  const prior: ClauseOrigin[] = [];
  if (raw.prior !== undefined) {
    if (!Array.isArray(raw.prior)) {
      issue(issues, "provenance_invalid", path + ".prior", "Clause lineage must be an array.");
      return null;
    }
    for (const [index, item] of raw.prior.entries()) {
      const priorPath = path + ".prior[" + index + "]";
      if (!isObject(item)) {
        issue(issues, "provenance_invalid", priorPath, "A lineage entry must be an object.");
        return null;
      }
      exactKeys(item, ["packId", "version", "operation", "reason", "layerRole"], priorPath, issues);
      const parsed = readOrigin(item, priorPath, issues, false);
      if (!parsed) return null;
      prior.push(parsed);
    }
  }
  return { definitionId: raw.definitionId, ...origin, ...(prior.length > 0 ? { prior } : {}) };
}

function readApplicability(raw: unknown, issues: StudyContractIssue[]): PackApplicability | null {
  if (!isObject(raw) || typeof raw.jurisdiction !== "string" || raw.jurisdiction.trim() === "" ||
      (raw.verification !== "REVIEWED" && raw.verification !== "UNVERIFIED")) {
    issue(issues, "applicability_invalid", "$.applicability", "Applicability label and review state are required.");
    return null;
  }
  exactKeys(raw, ["jurisdiction", "verification", "effectiveFrom", "effectiveTo", "intentHints", "documentHints"], "$.applicability", issues);
  if ((raw.effectiveFrom !== undefined && !validDate(raw.effectiveFrom)) || (raw.effectiveTo !== undefined && !validDate(raw.effectiveTo)) ||
      (validDate(raw.effectiveFrom) && validDate(raw.effectiveTo) && raw.effectiveFrom > raw.effectiveTo)) {
    issue(issues, "applicability_dates", "$.applicability", "Invalid effective date interval.");
    return null;
  }
  return structuredClone(raw) as PackApplicability;
}

function latestProvenance(definition: EffectiveDefinition, layers: readonly PackLayerRef[]): ClauseProvenance | null {
  const layer = layers.find((item) => item.packId === definition.origin.packId && item.version === definition.origin.version);
  if (!layer) return null;
  if (definition.origin.operation === "disable") return null;
  if ((definition.origin.operation === "base") !== (layer.role === "BASE")) return null;
  if (definition.origin.operation !== "base" && (!definition.origin.reason || definition.origin.reason.trim() === "")) return null;
  return {
    definitionId: definition.id,
    packId: definition.origin.packId,
    version: definition.origin.version,
    operation: definition.origin.operation,
    ...(definition.origin.reason ? { reason: definition.origin.reason } : {}),
    layerRole: layer.role,
  };
}

export function parseEffectiveDomainPack(raw: unknown): StudyContractResult<EffectiveDomainPack> {
  const issues: StudyContractIssue[] = [];
  if (!isObject(raw)) return finish([{ code: "pack_invalid", path: "$", message: "Expected an object." }], undefined as never);
  exactKeys(raw, [
    "schema", "digest", "definitionsDigest", "publication", "layers", "decisions", "applicability",
    "attributes", "definitions", "provenance", "clauseExpressions", "disabled",
  ], "$", issues);
  if (raw.schema !== EFFECTIVE_DOMAIN_PACK_SCHEMA) issue(issues, "schema_invalid", "$.schema", "Unsupported effective pack schema.");
  if (raw.publication !== "UNPUBLISHED") issue(issues, "pack_publication", "$.publication", "An effective pack is unpublished.");
  const digest = raw.digest;
  const definitionsDigest = raw.definitionsDigest;
  if (!validDigest(digest)) issue(issues, "digest_invalid", "$.digest", "Expected a SHA-256 digest.");
  if (!validDigest(definitionsDigest)) issue(issues, "digest_invalid", "$.definitionsDigest", "Expected a SHA-256 digest.");
  const applicability = readApplicability(raw.applicability, issues);
  const attributes = readCaseAttributes(raw.attributes, "$.attributes", issues);
  const layers = readLayers(raw.layers, issues);
  const decisions = readDecisions(raw.decisions, issues);
  const definitions = readDefinitions(raw.definitions, issues);
  const provenance = readProvenance(raw.provenance, issues);
  const clauseExpressions = readClauseExpressions(raw.clauseExpressions, issues);
  const disabled = readDisabled(raw.disabled, issues);
  if (!applicability || !attributes || !layers || !decisions || !definitions || !provenance || !clauseExpressions || !disabled || issues.length > 0) {
    return finish(issues, undefined as never);
  }
  const attributeMap = new Map(attributes.map((attribute) => [attribute.key, attribute]));
  for (const decision of decisions) {
    const evaluated = evaluateApplicability(decision.expression, attributeMap);
    if (!evaluated.ok) issue(issues, evaluated.code, decision.packId, evaluated.message);
    else if (evaluated.result !== decision.result || decision.included !== (decision.result === "TRUE") || decision.result === "UNKNOWN") {
      issue(issues, "decision_mismatch", decision.packId, "Applicability decision does not match the stored attributes.");
    }
  }
  const included = decisions.filter((decision) => decision.included);
  if (included.length !== layers.length || included.some((decision, index) => decision.digest !== layers[index]?.digest || decision.role !== layers[index]?.role)) {
    issue(issues, "decision_mismatch", "$.layers", "Layers are the included applicability decisions, in order.");
  }
  if (layers[0]?.role !== "BASE") issue(issues, "layer_role", "$.layers[0]", "The first included layer is the base.");
  if (!validDigest(definitionsDigest) || packDigest(definitions) !== definitionsDigest) {
    issue(issues, "definitions_digest_mismatch", "$.definitionsDigest", "Definition digest does not match the definitions.");
  }
  if (provenance.length !== definitions.length || provenance.some((item, index) => item.definitionId !== definitions[index]?.id)) {
    issue(issues, "provenance_mismatch", "$.provenance", "Each definition needs matching provenance.");
  }
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  for (const definition of definitions) {
    const item = provenance.find((entry) => entry.definitionId === definition.id);
    const expected = latestProvenance(definition, layers);
    if (!item || !expected) {
      issue(issues, "provenance_mismatch", definition.id, "Provenance does not match the definition origin.");
      continue;
    }
    const { prior: _prior, ...latest } = item;
    if (canonicalPackJson(latest) !== canonicalPackJson(expected)) {
      issue(issues, "provenance_mismatch", definition.id, "Provenance does not match the definition origin.");
    }
    for (const earlier of item.prior ?? []) {
      if (!layers.some((layer) => layer.packId === earlier.packId && layer.version === earlier.version && layer.role === earlier.layerRole)) {
        issue(issues, "provenance_unresolved", definition.id, "Clause lineage names a layer that was not included.");
      }
    }
  }
  if (disabled.some((item) => definitionIds.has(item.definitionId))) {
    issue(issues, "disable_conflict", "$.disabled", "A disabled clause is still an effective definition.");
  }
  for (const clause of clauseExpressions) {
    if (!definitionIds.has(clause.definitionId)) issue(issues, "clause_expression", clause.definitionId, "Clause expression names an unknown definition.");
  }
  if (issues.length > 0 || !validDigest(digest) || !validDigest(definitionsDigest)) return finish(issues, undefined as never);
  const built: Omit<EffectiveDomainPack, "digest"> = {
    schema: EFFECTIVE_DOMAIN_PACK_SCHEMA,
    definitionsDigest,
    publication: "UNPUBLISHED",
    layers,
    decisions,
    applicability,
    attributes,
    definitions,
    provenance,
    clauseExpressions,
    disabled,
  };
  if (!validDigest(digest) || !validDigest(definitionsDigest) || packDigest(packDigestBody(built)) !== digest) {
    issue(issues, "digest_mismatch", "$.digest", "Effective pack digest does not match its body.");
  }
  return finish(issues, { ...built, digest });
}

function readLayers(raw: unknown, issues: StudyContractIssue[]): PackLayerRef[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16) {
    issue(issues, "layers_invalid", "$.layers", "Expected a base layer and optional extensions.");
    return null;
  }
  const layers: PackLayerRef[] = [];
  raw.forEach((item, index) => {
    const path = "$.layers[" + index + "]";
    if (!isObject(item)) {
      issue(issues, "layer_invalid", path, "A layer must be an object.");
      return;
    }
    exactKeys(item, ["role", "packId", "version", "digest", "ownership"], path, issues);
    const ownership = readOwner(item.ownership, path + ".ownership", issues);
    if (!(LAYER_ROLES as readonly string[]).includes(String(item.role))) issue(issues, "layer_role", path + ".role", "Layer role is not recognized.");
    if ((index === 0 && item.role !== "BASE") || (index > 0 && item.role === "BASE")) issue(issues, "layer_role", path + ".role", "Only the first layer is the base.");
    if (index > 0 && ownership && item.role !== ownership.scope) issue(issues, "layer_role", path + ".role", "An extension layer uses its owner scope.");
    if (!validId(item.packId) || typeof item.version !== "string" || !VERSION.test(item.version) || !validDigest(item.digest) || !ownership) {
      issue(issues, "layer_invalid", path, "Layer id, version, digest, and ownership are required.");
      return;
    }
    layers.push({ role: item.role as PackLayerRole, packId: item.packId, version: item.version, digest: item.digest, ownership });
  });
  if (layers.length !== raw.length || issues.some((item) => item.path.startsWith("$.layers"))) return null;
  return layers;
}

function readDecisions(raw: unknown, issues: StudyContractIssue[]): ApplicabilityDecision[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16) {
    issue(issues, "decisions_invalid", "$.decisions", "Applicability decisions are required.");
    return null;
  }
  const decisions: ApplicabilityDecision[] = [];
  raw.forEach((item, index) => {
    const path = "$.decisions[" + index + "]";
    if (!isObject(item)) {
      issue(issues, "decision_invalid", path, "A decision must be an object.");
      return;
    }
    exactKeys(item, ["packId", "version", "digest", "role", "result", "included", "expression"], path, issues);
    const expression = readExpression(item.expression, path + ".expression", issues);
    if (!expression || canonicalPackJson(expression) !== canonicalPackJson(item.expression)) {
      issue(issues, "expression_not_canonical", path + ".expression", "Applicability expressions are stored in canonical form.");
    }
    if (!validId(item.packId) || typeof item.version !== "string" || !VERSION.test(item.version) || !validDigest(item.digest) || !expression) {
      issue(issues, "decision_invalid", path, "Decision id, version, digest, and expression are required.");
      return;
    }
    if (!(LAYER_ROLES as readonly string[]).includes(String(item.role))) issue(issues, "layer_role", path + ".role", "Decision role is not recognized.");
    if (item.result !== "TRUE" && item.result !== "FALSE" && item.result !== "UNKNOWN") {
      issue(issues, "decision_invalid", path + ".result", "Applicability result must be TRUE, FALSE, or UNKNOWN.");
      return;
    }
    if (typeof item.included !== "boolean") {
      issue(issues, "decision_invalid", path + ".included", "Inclusion must be boolean.");
      return;
    }
    decisions.push({
      packId: item.packId,
      version: item.version,
      digest: item.digest,
      role: item.role as PackLayerRole,
      result: item.result,
      included: item.included,
      expression,
    });
  });
  if (decisions.length !== raw.length || issues.some((item) => item.path.startsWith("$.decisions"))) return null;
  return decisions;
}

function readDefinitions(raw: unknown, issues: StudyContractIssue[]): EffectiveDefinition[] | null {
  if (!Array.isArray(raw)) {
    issue(issues, "definitions_invalid", "$.definitions", "Definitions must be an array.");
    return null;
  }
  const definitions: EffectiveDefinition[] = [];
  const kinds = new Set(["persona", "report", "term", "note", "guideline", "referenceTable", "entity", "chain", "workflow", "relationship", "document", "check", "calculation", "question"]);
  for (const [index, item] of raw.entries()) {
    const path = "$.definitions[" + index + "]";
    if (!isObject(item) || !validId(item.id) || typeof item.kind !== "string" || typeof item.label !== "string" || !isObject(item.origin)) {
      issue(issues, "definition_invalid", path, "A definition needs an id, kind, label, and origin.");
      continue;
    }
    if (!kinds.has(item.kind)) issue(issues, "definition_kind", path + ".kind", "Definition kind is not part of the pack contract.");
    definitions.push(item as unknown as EffectiveDefinition);
  }
  if (definitions.length !== raw.length || issues.some((item) => item.path.startsWith("$.definitions"))) return null;
  const sorted = [...definitions].sort((left, right) => left.id.localeCompare(right.id));
  if (definitions.some((definition, index) => definition.id !== sorted[index]?.id)) {
    issue(issues, "definitions_order", "$.definitions", "Definitions must be sorted by id.");
    return null;
  }
  if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length) {
    issue(issues, "duplicate_definition", "$.definitions", "Definition ids must be unique.");
    return null;
  }
  return definitions;
}

function readProvenance(raw: unknown, issues: StudyContractIssue[]): ClauseProvenance[] | null {
  if (!Array.isArray(raw)) {
    issue(issues, "provenance_invalid", "$.provenance", "Provenance must be an array.");
    return null;
  }
  const provenance: ClauseProvenance[] = [];
  raw.forEach((item, index) => {
    const parsed = readClauseProvenance(item, "$.provenance[" + index + "]", issues);
    if (parsed) provenance.push(parsed);
  });
  if (provenance.length !== raw.length) return null;
  return provenance;
}

function readClauseExpressions(raw: unknown, issues: StudyContractIssue[]): ClauseExpression[] | null {
  if (!Array.isArray(raw)) {
    issue(issues, "clause_expressions_invalid", "$.clauseExpressions", "Clause expressions must be an array.");
    return null;
  }
  const expressions: ClauseExpression[] = [];
  for (const [index, item] of raw.entries()) {
    const path = "$.clauseExpressions[" + index + "]";
    if (!isObject(item)) {
      issue(issues, "clause_expression", path, "A clause expression must be an object.");
      return null;
    }
    exactKeys(item, ["definitionId", "expression"], path, issues);
    const expression = readExpression(item.expression, path + ".expression", issues);
    if (!validId(item.definitionId) || !expression) return null;
    if (canonicalPackJson(expression) !== canonicalPackJson(item.expression)) {
      issue(issues, "expression_not_canonical", path + ".expression", "Applicability expressions are stored in canonical form.");
      return null;
    }
    expressions.push({ definitionId: item.definitionId, expression });
  }
  return expressions;
}

function readDisabled(raw: unknown, issues: StudyContractIssue[]): DisabledClause[] | null {
  if (!Array.isArray(raw)) {
    issue(issues, "disabled_invalid", "$.disabled", "Disabled clauses must be an array.");
    return null;
  }
  const disabled: DisabledClause[] = [];
  for (const [index, item] of raw.entries()) {
    const path = "$.disabled[" + index + "]";
    if (!isObject(item)) {
      issue(issues, "disabled_invalid", path, "A disabled clause must be an object.");
      return null;
    }
    exactKeys(item, ["definitionId", "reason"], path, issues);
    if (!validId(item.definitionId) || typeof item.reason !== "string" || item.reason.trim() === "") {
      issue(issues, "disabled_invalid", path, "A disabled clause needs an id and a reason.");
      return null;
    }
    disabled.push({ definitionId: item.definitionId, reason: item.reason });
  }
  return disabled;
}
