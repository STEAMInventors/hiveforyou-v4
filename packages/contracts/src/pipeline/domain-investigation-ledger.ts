/**
 * Offline investigation coverage ledger.
 * Accounts for every plan task, including supplemental, unsupported, deferred, and disabled tasks.
 * evaluateDomainRules runs only on independently verified facts and relationships.
 * An unresolved relationship candidate stays a review record and is never copied into that evidence.
 * A cross-entity calculation result is the declared relationship plus one ordered endpoint pair.
 * Ontology subject cardinality does not choose that pair, and it does not merge distinct pairs.
 * A computed day count and an established check are evidence dispositions, not legal conclusions.
 */
import { packDigest } from "./domain-pack-compiler";
import {
  UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA,
  type UnresolvedCandidate,
  type UnresolvedCandidates,
} from "./domain-investigation-binder";
import {
  DOMAIN_INVESTIGATION_PLAN_SCHEMA,
  type DomainInvestigationPlan,
  type InvestigationTask,
  type PlanAuthority,
} from "./domain-investigation-plan";
import {
  DOMAIN_PACK_RUNTIME_SCHEMA,
  type CompiledDomainPack,
  type EffectiveDefinition,
} from "./domain-pack-source";
import {
  evaluateDomainRules,
  VERIFIED_CASE_FACTS_SCHEMA,
  type DomainRuleEvaluation,
  type DomainRuleResult,
  type VerifiedCaseFacts,
  type VerifiedFact,
  type VerifiedRelationshipFact,
  type VerifiedSourceRef,
} from "./domain-pack-rules";

export const DOMAIN_INVESTIGATION_LEDGER_SCHEMA = "hive.domain-investigation-ledger/1" as const;
export const DOMAIN_INVESTIGATION_LEDGER_VERSION = "1.0.0" as const;

export const LEDGER_DISPOSITIONS = [
  "COMPUTED",
  "ESTABLISHED",
  "NOT_ESTABLISHED",
  "NOT_SATISFIED",
  "CONFLICT",
  "NOT_EVALUATED",
  "UNSUPPORTED",
  "DISABLED",
  "DEFERRED",
  "PRESENTATION",
  "UNRESOLVED_INSTANCE",
] as const;
export type LedgerDisposition = (typeof LEDGER_DISPOSITIONS)[number];

export const LEDGER_POPULATIONS = [
  "PRESENTATION",
  "ONCE",
  "NO_INSTANCE",
  "UNRESOLVED_INSTANCE",
  "VERIFIED_INSTANCE",
  "UNRESOLVED_SUBJECT",
] as const;
export type LedgerPopulation = (typeof LEDGER_POPULATIONS)[number];

export const AUTHORITY_GATES = [
  "PUBLICATION_UNPUBLISHED",
  "UNVERIFIED_APPLICABILITY",
  "UNKNOWN_JURISDICTION",
  "UNREVIEWED_AUTHORITY",
] as const;
export type AuthorityGate = (typeof AUTHORITY_GATES)[number];

export type LedgerInstance = { entityId: string; instanceId: string };

export type LedgerRow = {
  rowId: string;
  taskId: string;
  taskKind: string;
  definitionId: string;
  population: LedgerPopulation;
  instances: LedgerInstance[];
  disposition: LedgerDisposition;
  reasonCodes: string[];
  authorityGate: AuthorityGate[];
  authorityIds: string[];
  authorities: PlanAuthority[];
  supportingFactIds: string[];
  relationshipFactIds: string[];
  sourceRefs: VerifiedSourceRef[];
  missingRequirements: string[];
  daysBetween?: string;
  candidateId?: string;
  candidateTrust?: UnresolvedCandidate["trust"];
  unresolvedCandidateIds?: string[];
  disabledReason?: string;
  evidenceForLink?: string;
};

export type DomainInvestigationLedger = {
  schema: typeof DOMAIN_INVESTIGATION_LEDGER_SCHEMA;
  ledgerVersion: typeof DOMAIN_INVESTIGATION_LEDGER_VERSION;
  digest: string;
  planDigest: string;
  evidenceDigest: string;
  packDigest: string;
  plannerVersion: DomainInvestigationPlan["plannerVersion"];
  pack: DomainInvestigationPlan["pack"];
  ownership: DomainInvestigationPlan["ownership"];
  applicability: DomainInvestigationPlan["applicability"];
  upstream?: DomainInvestigationPlan["upstream"];
  supplemental: DomainInvestigationPlan["supplemental"];
  /** Copied from the verified facts. Independent of whether every task has a row. */
  evidenceCoverage: VerifiedCaseFacts["coverage"];
  /** True only when every required task and presentation row is present. */
  taskAccountingComplete: true;
  rows: LedgerRow[];
};

export type LedgerIssue = { code: string; path: string; message: string };
export type CoverageLedgerResult =
  | { ok: true; value: DomainInvestigationLedger }
  | { ok: false; issues: LedgerIssue[] };

export type CoverageLedgerInput = {
  plan: DomainInvestigationPlan;
  pack: CompiledDomainPack;
  verified: VerifiedCaseFacts;
  unresolved: UnresolvedCandidates;
  evidenceDigest: string;
};

type Draft = {
  taskId: string;
  taskKind: string;
  definitionId: string;
  population: LedgerPopulation;
  instances: LedgerInstance[];
  disposition: LedgerDisposition;
  reasonCodes: string[];
  authorities: readonly PlanAuthority[];
  supportingFactIds: string[];
  relationshipFactIds: string[];
  sourceRefs: VerifiedSourceRef[];
  missingRequirements: string[];
  daysBetween?: string;
  candidateId?: string;
  candidateTrust?: UnresolvedCandidate["trust"];
  unresolvedCandidateIds?: string[];
  disabledReason?: string;
  evidenceForLink?: string;
};

type ReadyEvaluation = Extract<DomainRuleEvaluation, { ok: true }>;

const AFFIRMATIVE = new Set<LedgerDisposition>(["COMPUTED", "ESTABLISHED", "NOT_SATISFIED"]);

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function issue(into: LedgerIssue[], code: string, path: string, message: string): void {
  into.push({ code, path, message });
}

function fail(issues: LedgerIssue[]): CoverageLedgerResult {
  const sorted = [...issues].sort((left, right) => (left.path + "\0" + left.code).localeCompare(right.path + "\0" + right.code));
  return { ok: false, issues: sorted };
}

function codes(...groups: readonly (readonly string[] | string | undefined)[]): string[] {
  const set = new Set<string>();
  for (const group of groups) {
    if (!group) continue;
    if (typeof group === "string") set.add(group);
    else for (const code of group) if (code) set.add(code);
  }
  return [...set].sort((left, right) => left.localeCompare(right));
}

function sortIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function sortInstances(instances: readonly LedgerInstance[]): LedgerInstance[] {
  return [...instances].sort((left, right) => left.entityId.localeCompare(right.entityId) || left.instanceId.localeCompare(right.instanceId));
}

function instanceKey(instances: readonly LedgerInstance[]): string {
  return sortInstances(instances).map((item) => item.entityId + "=" + item.instanceId).join("|");
}

function sortRefs(refs: readonly VerifiedSourceRef[]): VerifiedSourceRef[] {
  const seen = new Set<string>();
  const result: VerifiedSourceRef[] = [];
  for (const ref of refs) {
    if (!ref?.documentId) continue;
    const copy: VerifiedSourceRef = {
      documentId: ref.documentId,
      ...(ref.page !== undefined ? { page: ref.page } : {}),
      ...(ref.excerptId !== undefined ? { excerptId: ref.excerptId } : {}),
    };
    const key = copy.documentId + "\0" + (copy.page ?? "") + "\0" + (copy.excerptId ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(copy);
  }
  return result.sort((left, right) => (left.documentId + (left.page ?? "") + (left.excerptId ?? "")).localeCompare(right.documentId + (right.page ?? "") + (right.excerptId ?? "")));
}

function copyAuthority(authority: PlanAuthority): PlanAuthority {
  return {
    authorityId: authority.authorityId,
    role: authority.role,
    authorityType: authority.authorityType,
    evidenceStrength: authority.evidenceStrength,
    practiceClass: authority.practiceClass,
    humanReview: authority.humanReview,
    verificationStatus: authority.verificationStatus,
    establishes: authority.establishes,
    doesNotEstablish: authority.doesNotEstablish,
    limitations: [...authority.limitations],
    heldAsLimitation: authority.heldAsLimitation,
    unreviewed: authority.unreviewed,
  };
}

function authorityGate(plan: DomainInvestigationPlan, authorities: readonly PlanAuthority[]): AuthorityGate[] {
  const gates: AuthorityGate[] = [];
  if (plan.pack.publication === "UNPUBLISHED") gates.push("PUBLICATION_UNPUBLISHED");
  if (plan.applicability.verification !== "REVIEWED") gates.push("UNVERIFIED_APPLICABILITY");
  if (!plan.applicability.jurisdictionEstablished) gates.push("UNKNOWN_JURISDICTION");
  if (authorities.some((authority) => authority.unreviewed)) gates.push("UNREVIEWED_AUTHORITY");
  return gates;
}

function relationshipKey(relationshipId: string, fromInstanceId: string, toInstanceId: string): string {
  return relationshipId + "\0" + fromInstanceId + "\0" + toInstanceId;
}

/** One relationship: prefix. Definition ids already begin with that word. */
function relationshipRequirement(relationshipId: string): string {
  return relationshipId.startsWith("relationship:") ? relationshipId : "relationship:" + relationshipId;
}

function normalizeMissingRequirement(requirement: string): string {
  return requirement.startsWith("relationship:relationship:") ? requirement.slice("relationship:".length) : requirement;
}

function refKey(ref: VerifiedSourceRef): string {
  return ref.documentId + "\0" + (ref.page ?? "") + "\0" + (ref.excerptId ?? "");
}

function sourced(refs: readonly VerifiedSourceRef[]): boolean {
  return refs.some((ref) => !!ref.documentId);
}

function canonicalizeEvidence(verified: VerifiedCaseFacts, unresolved: UnresolvedCandidates): { verified: VerifiedCaseFacts; unresolved: UnresolvedCandidates } {
  return {
    verified: {
      schema: verified.schema,
      coverage: verified.coverage,
      facts: [...verified.facts].sort((left, right) => left.id.localeCompare(right.id)),
      documents: [...verified.documents].sort((left, right) => left.id.localeCompare(right.id)),
      relationships: [...verified.relationships].sort((left, right) => left.id.localeCompare(right.id)),
      conflicts: [...verified.conflicts].sort((left, right) => (left.entityId + left.instanceId + left.fieldId).localeCompare(right.entityId + right.instanceId + right.fieldId)),
    },
    unresolved: {
      schema: unresolved.schema,
      candidates: [...unresolved.candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId) || left.kind.localeCompare(right.kind)),
    },
  };
}

/** Canonical digest of verified facts and unresolved candidates. Array order does not change it. */
export function investigationEvidenceDigest(verified: VerifiedCaseFacts, unresolved: UnresolvedCandidates): string {
  const evidence = canonicalizeEvidence(verified, unresolved);
  return packDigest({ verified: evidence.verified, unresolved: evidence.unresolved });
}

function instancesOf(entityId: string, evidence: VerifiedCaseFacts): string[] {
  const ids = new Set<string>();
  for (const fact of evidence.facts) {
    if (fact.entityId === entityId && fact.status === "VERIFIED" && sourced(fact.sourceRefs)) ids.add(fact.instanceId);
  }
  for (const document of evidence.documents) {
    if (document.subject?.entityId === entityId && document.status === "VERIFIED" && sourced(document.sourceRefs)) ids.add(document.subject.instanceId);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

function factsFor(evidence: VerifiedCaseFacts, entityId: string, instanceId: string): VerifiedFact[] {
  return evidence.facts.filter((fact) => fact.entityId === entityId && fact.instanceId === instanceId && sourced(fact.sourceRefs))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function definitionOf(pack: CompiledDomainPack, definitionId: string): EffectiveDefinition | undefined {
  return pack.definitions.find((definition) => definition.id === definitionId);
}

function resultsFor(evaluation: ReadyEvaluation, ruleId: string): DomainRuleResult[] {
  return evaluation.results.filter((result) => result.ruleId === ruleId);
}

function adoptionMode(task: InvestigationTask): "same" | "cross" | "pair" | "none" {
  if (!task.dp2Eligible) return "none";
  if (task.resultBinding) return "pair";
  if (task.coverage.population !== "PER_SUBJECT_INSTANCE") return "none";
  return task.join && typeof task.join === "object" ? "cross" : "same";
}

function questionReason(task: InvestigationTask): string | undefined {
  if (task.taskKind === "REVIEW_CHECK" || task.taskKind === "ASK_QUESTION") return "REVIEW_REQUIRED";
  if (task.taskKind === "DECLARED_CALCULATION") return "CALCULATION_NOT_EXECUTABLE";
  return undefined;
}

function finish(plan: DomainInvestigationPlan, draft: Draft): LedgerRow {
  const instances = sortInstances(draft.instances);
  const authorities = [...draft.authorities].map(copyAuthority).sort((left, right) => left.authorityId.localeCompare(right.authorityId));
  const row: LedgerRow = {
    rowId: [draft.taskId, draft.population, instanceKey(instances), draft.candidateId ?? ""].join("\u001f"),
    taskId: draft.taskId,
    taskKind: draft.taskKind,
    definitionId: draft.definitionId,
    population: draft.population,
    instances,
    disposition: draft.disposition,
    reasonCodes: codes(draft.reasonCodes),
    authorityGate: authorityGate(plan, authorities),
    authorityIds: authorities.map((authority) => authority.authorityId),
    authorities,
    supportingFactIds: sortIds(draft.supportingFactIds),
    relationshipFactIds: sortIds(draft.relationshipFactIds),
    sourceRefs: sortRefs(draft.sourceRefs),
    missingRequirements: sortIds(draft.missingRequirements.map(normalizeMissingRequirement)),
    ...(draft.daysBetween !== undefined ? { daysBetween: draft.daysBetween } : {}),
    ...(draft.candidateId ? { candidateId: draft.candidateId } : {}),
    ...(draft.candidateTrust ? { candidateTrust: draft.candidateTrust } : {}),
    ...(draft.unresolvedCandidateIds && draft.unresolvedCandidateIds.length > 0 ? { unresolvedCandidateIds: sortIds(draft.unresolvedCandidateIds) } : {}),
    ...(draft.disabledReason ? { disabledReason: draft.disabledReason } : {}),
    ...(draft.evidenceForLink ? { evidenceForLink: draft.evidenceForLink } : {}),
  };
  return row;
}

function base(task: InvestigationTask, population: LedgerPopulation, disposition: LedgerDisposition, extra: Partial<Draft> = {}): Draft {
  return {
    taskId: task.taskId,
    taskKind: task.taskKind,
    definitionId: task.definitionId,
    population,
    instances: extra.instances ?? [],
    disposition,
    reasonCodes: codes(task.reasonCodes, extra.reasonCodes),
    authorities: task.authorities,
    supportingFactIds: extra.supportingFactIds ?? [],
    relationshipFactIds: extra.relationshipFactIds ?? [],
    sourceRefs: extra.sourceRefs ?? [],
    missingRequirements: extra.missingRequirements ?? [],
    ...(extra.daysBetween !== undefined ? { daysBetween: extra.daysBetween } : {}),
    ...(extra.candidateId ? { candidateId: extra.candidateId } : {}),
    ...(extra.candidateTrust ? { candidateTrust: extra.candidateTrust } : {}),
    ...(extra.unresolvedCandidateIds ? { unresolvedCandidateIds: extra.unresolvedCandidateIds } : {}),
    ...(extra.disabledReason ? { disabledReason: extra.disabledReason } : {}),
    ...(extra.evidenceForLink ? { evidenceForLink: extra.evidenceForLink } : {}),
  };
}

function candidateInstances(candidate: UnresolvedCandidate): LedgerInstance[] {
  const instances: LedgerInstance[] = [];
  if (candidate.entityId && candidate.instanceId) instances.push({ entityId: candidate.entityId, instanceId: candidate.instanceId });
  if (candidate.fromEntityId && candidate.fromInstanceId) instances.push({ entityId: candidate.fromEntityId, instanceId: candidate.fromInstanceId });
  if (candidate.toEntityId && candidate.toInstanceId) instances.push({ entityId: candidate.toEntityId, instanceId: candidate.toInstanceId });
  return instances;
}

function candidateRow(task: InvestigationTask, candidate: UnresolvedCandidate): Draft {
  const reviewRelationship = candidate.kind === "RELATIONSHIP" && candidate.trust === "REVIEW_REQUIRED";
  return base(task, "UNRESOLVED_INSTANCE", reviewRelationship ? "NOT_EVALUATED" : "UNRESOLVED_INSTANCE", {
    instances: candidateInstances(candidate),
    reasonCodes: codes(candidate.reasons, reviewRelationship || task.taskKind === "REVIEW_CHECK" || task.taskKind === "ASK_QUESTION" ? "REVIEW_REQUIRED" : undefined),
    sourceRefs: [...candidate.sourceRefs],
    candidateId: candidate.candidateId,
    candidateTrust: candidate.trust,
    ...(task.evidenceForLink ? { evidenceForLink: task.evidenceForLink } : {}),
  });
}

function splitSupport(result: DomainRuleResult, relationshipIds: ReadonlySet<string>): { supportingFactIds: string[]; relationshipFactIds: string[] } {
  return {
    supportingFactIds: result.supportingFactIds.filter((id) => !relationshipIds.has(id)),
    relationshipFactIds: result.supportingFactIds.filter((id) => relationshipIds.has(id)),
  };
}

function adopted(task: InvestigationTask, result: DomainRuleResult, relationshipIds: ReadonlySet<string>): Draft {
  const support = splitSupport(result, relationshipIds);
  return base(task, "VERIFIED_INSTANCE", result.outcome, {
    instances: result.instances,
    reasonCodes: codes(task.reasonCodes, result.reasonCodes),
    supportingFactIds: support.supportingFactIds,
    relationshipFactIds: support.relationshipFactIds,
    sourceRefs: result.sourceRefs,
    missingRequirements: result.missingRequirements,
    ...(result.daysBetween !== undefined ? { daysBetween: result.daysBetween } : {}),
  });
}

function sameInstanceRows(
  task: InvestigationTask,
  evaluation: ReadyEvaluation,
  verifiedIds: readonly string[],
  candidates: readonly UnresolvedCandidate[],
  issues: LedgerIssue[],
  relationshipIds: ReadonlySet<string>,
): Draft[] {
  const subjectId = task.coverage.population === "PER_SUBJECT_INSTANCE" ? task.coverage.subjectEntityId : "";
  const results = resultsFor(evaluation, task.definitionId);
  const byKey = new Map<string, DomainRuleResult>();
  for (const result of results) {
    if (result.instances.length === 0) continue;
    const key = instanceKey(result.instances);
    if (byKey.has(key)) issue(issues, "inconsistent_dp2", task.taskId, "DP-2 returned more than one row for the same instances.");
    byKey.set(key, result);
  }
  const drafts: Draft[] = [];
  for (const instanceId of verifiedIds) {
    const key = instanceKey([{ entityId: subjectId, instanceId }]);
    const result = byKey.get(key);
    if (!result) {
      issue(issues, "inconsistent_dp2", task.taskId, "DP-2 did not return the verified instance.");
      continue;
    }
    const draft = adopted(task, result, relationshipIds);
    draft.unresolvedCandidateIds = candidates
      .filter((candidate) => candidate.kind === "FIELD" && candidate.entityId === subjectId && candidate.instanceId === instanceId)
      .map((candidate) => candidate.candidateId);
    drafts.push(draft);
  }
  for (const result of results) {
    if (result.instances.length === 0) continue;
    if (!verifiedIds.includes(result.instances.find((item) => item.entityId === subjectId)?.instanceId ?? "")) {
      issue(issues, "inconsistent_dp2", task.taskId, "DP-2 returned an instance the ledger did not account for.");
    }
  }
  return drafts;
}

function subjectFieldGaps(pack: CompiledDomainPack, definitionId: string, entityId: string, instanceId: string, evidence: VerifiedCaseFacts): string[] {
  const definition = definitionOf(pack, definitionId);
  if (definition?.kind !== "calculation") return [];
  const gaps: string[] = [];
  for (const binding of definition.bindings ?? []) {
    if (binding.entityId !== entityId) continue;
    const present = evidence.facts.some((fact) => fact.entityId === entityId && fact.instanceId === instanceId && fact.fieldId === binding.fieldId && sourced(fact.sourceRefs));
    if (!present) gaps.push("field:" + entityId + "/" + binding.fieldId);
  }
  return gaps;
}

function crossRows(
  task: InvestigationTask,
  pack: CompiledDomainPack,
  evidence: VerifiedCaseFacts,
  evaluation: ReadyEvaluation,
  verifiedIds: readonly string[],
  candidates: readonly UnresolvedCandidate[],
  issues: LedgerIssue[],
  relationshipIds: ReadonlySet<string>,
): Draft[] {
  const subjectId = task.coverage.population === "PER_SUBJECT_INSTANCE" ? task.coverage.subjectEntityId : "";
  const results = resultsFor(evaluation, task.definitionId);
  const pairs = results.filter((result) => result.instances.length > 0);
  const blank = results.find((result) => result.instances.length === 0);
  if (blank && (blank.outcome === "COMPUTED" || blank.daysBetween !== undefined)) {
    issue(issues, "inconsistent_dp2", task.taskId, "DP-2 computed a day count without instances.");
  }
  const drafts: Draft[] = [];
  const covered = new Set<string>();
  for (const result of pairs) {
    if (result.outcome === "COMPUTED" && result.daysBetween === undefined) {
      issue(issues, "inconsistent_dp2", task.taskId, "DP-2 reported a computed row without a day count.");
    }
    const draft = adopted(task, result, relationshipIds);
    drafts.push(draft);
    for (const item of result.instances) if (item.entityId === subjectId) covered.add(item.instanceId);
  }
  for (const instanceId of verifiedIds) {
    if (covered.has(instanceId)) continue;
    const facts = factsFor(evidence, subjectId, instanceId);
    drafts.push(base(task, "VERIFIED_INSTANCE", "NOT_EVALUATED", {
      instances: [{ entityId: subjectId, instanceId }],
      reasonCodes: codes(blank?.reasonCodes, "CROSS_ENTITY"),
      supportingFactIds: facts.map((fact) => fact.id),
      sourceRefs: facts.flatMap((fact) => fact.sourceRefs),
      missingRequirements: [
        ...(blank?.missingRequirements ?? []),
        ...subjectFieldGaps(pack, task.definitionId, subjectId, instanceId, evidence),
        ...(task.join ? [relationshipRequirement(task.join.relationshipId)] : []),
      ],
      unresolvedCandidateIds: candidates
        .filter((candidate) => candidate.kind === "FIELD" && candidate.entityId === subjectId && candidate.instanceId === instanceId)
        .map((candidate) => candidate.candidateId),
    }));
  }
  return drafts;
}

function endpointCandidate(candidate: UnresolvedCandidate, entityId: string, verified: ReadonlySet<string>): boolean {
  return candidate.kind === "FIELD" && candidate.entityId === entityId && (!candidate.instanceId || !verified.has(candidate.instanceId));
}

function pairRows(
  task: InvestigationTask,
  pack: CompiledDomainPack,
  evidence: VerifiedCaseFacts,
  evaluation: ReadyEvaluation,
  candidates: readonly UnresolvedCandidate[],
  issues: LedgerIssue[],
  relationshipIds: ReadonlySet<string>,
): Draft[] {
  const binding = task.resultBinding;
  if (!binding) return [];
  const fromIds = instancesOf(binding.fromEntityId, evidence);
  const toIds = instancesOf(binding.toEntityId, evidence);
  const verifiedFrom = new Set(fromIds);
  const verifiedTo = new Set(toIds);
  const unresolved = candidates.filter((candidate) => endpointCandidate(candidate, binding.fromEntityId, verifiedFrom) || endpointCandidate(candidate, binding.toEntityId, verifiedTo));
  const drafts: Draft[] = unresolved.map((candidate) => candidateRow(task, candidate));
  if (fromIds.length === 0 && toIds.length === 0 && unresolved.length === 0) {
    drafts.push(noInstanceRow(task, evaluation, issues));
    return drafts;
  }
  const results = resultsFor(evaluation, task.definitionId);
  const pairs = results.filter((result) => result.instances.length > 0);
  const blank = results.find((result) => result.instances.length === 0);
  if (blank && (blank.outcome === "COMPUTED" || blank.daysBetween !== undefined)) {
    issue(issues, "inconsistent_dp2", task.taskId, "DP-2 computed a day count without instances.");
  }
  const seen = new Set<string>();
  const covered = new Set<string>();
  const cover = (entityId: string, instanceId: string) => covered.add(entityId + "\0" + instanceId);
  for (const result of pairs) {
    const key = instanceKey(result.instances);
    if (seen.has(key)) issue(issues, "inconsistent_dp2", task.taskId, "DP-2 returned more than one row for the same instances.");
    seen.add(key);
    if (result.outcome === "COMPUTED" && result.daysBetween === undefined) {
      issue(issues, "inconsistent_dp2", task.taskId, "DP-2 reported a computed row without a day count.");
    }
    const fromId = result.instances.find((item) => item.entityId === binding.fromEntityId)?.instanceId;
    const toId = result.instances.find((item) => item.entityId === binding.toEntityId)?.instanceId;
    const declared = fromId && toId
      ? evidence.relationships.filter((link) => link.relationshipId === binding.relationshipId && link.fromInstanceId === fromId && link.toInstanceId === toId && sourced(link.sourceRefs))
      : [];
    const declaredIds = new Set(declared.map((link) => link.id));
    const cited = result.supportingFactIds.filter((id) => relationshipIds.has(id));
    if (!fromId || !toId || result.instances.length !== 2 || cited.some((id) => !declaredIds.has(id)) || (result.outcome === "COMPUTED" && declared.length === 0)) {
      issue(issues, "inconsistent_dp2", task.taskId, "DP-2 returned a pair that is not the declared relationship.");
      continue;
    }
    const draft = adopted(task, result, relationshipIds);
    draft.unresolvedCandidateIds = candidates
      .filter((candidate) => candidate.kind === "FIELD" && result.instances.some((item) => item.entityId === candidate.entityId && item.instanceId === candidate.instanceId))
      .map((candidate) => candidate.candidateId);
    drafts.push(draft);
    cover(binding.fromEntityId, fromId);
    cover(binding.toEntityId, toId);
  }
  const uncovered = (entityId: string, instanceId: string) => {
    if (covered.has(entityId + "\0" + instanceId)) return;
    const facts = factsFor(evidence, entityId, instanceId);
    drafts.push(base(task, "VERIFIED_INSTANCE", "NOT_EVALUATED", {
      instances: [{ entityId, instanceId }],
      reasonCodes: codes("CROSS_ENTITY"),
      supportingFactIds: facts.map((fact) => fact.id),
      sourceRefs: facts.flatMap((fact) => fact.sourceRefs),
      missingRequirements: [
        ...subjectFieldGaps(pack, task.definitionId, entityId, instanceId, evidence),
        relationshipRequirement(binding.relationshipId),
      ],
      unresolvedCandidateIds: candidates
        .filter((candidate) => candidate.kind === "FIELD" && candidate.entityId === entityId && candidate.instanceId === instanceId)
        .map((candidate) => candidate.candidateId),
    }));
  };
  for (const instanceId of fromIds) uncovered(binding.fromEntityId, instanceId);
  for (const instanceId of toIds) uncovered(binding.toEntityId, instanceId);
  return drafts;
}

function withheldRows(task: InvestigationTask, evidence: VerifiedCaseFacts, verifiedIds: readonly string[], candidates: readonly UnresolvedCandidate[]): Draft[] {
  const subjectId = task.coverage.population === "PER_SUBJECT_INSTANCE" ? task.coverage.subjectEntityId : "";
  return verifiedIds.map((instanceId) => {
    const facts = factsFor(evidence, subjectId, instanceId);
    const attached = candidates.filter((candidate) => candidate.kind === "FIELD" && candidate.entityId === subjectId && candidate.instanceId === instanceId);
    return base(task, "VERIFIED_INSTANCE", "NOT_EVALUATED", {
      instances: [{ entityId: subjectId, instanceId }],
      reasonCodes: codes(questionReason(task)),
      supportingFactIds: facts.map((fact) => fact.id),
      sourceRefs: facts.flatMap((fact) => fact.sourceRefs),
      unresolvedCandidateIds: attached.map((candidate) => candidate.candidateId),
    });
  });
}

function noInstanceRow(task: InvestigationTask, evaluation: ReadyEvaluation, issues: LedgerIssue[]): Draft {
  const mode = adoptionMode(task);
  const blank = mode === "none" ? undefined : resultsFor(evaluation, task.definitionId).find((result) => result.instances.length === 0);
  if (blank && (blank.outcome === "COMPUTED" || blank.daysBetween !== undefined || blank.outcome === "ESTABLISHED" || blank.outcome === "NOT_SATISFIED")) {
    issue(issues, "inconsistent_dp2", task.taskId, "DP-2 reported an affirmative result with no instance.");
  }
  return base(task, "NO_INSTANCE", "NOT_EVALUATED", {
    reasonCodes: codes("NO_INSTANCE", questionReason(task), mode === "none" ? undefined : blank?.reasonCodes),
    missingRequirements: mode === "none" ? [] : blank?.missingRequirements ?? [],
  });
}

function subjectRows(
  task: InvestigationTask,
  pack: CompiledDomainPack,
  evidence: VerifiedCaseFacts,
  evaluation: ReadyEvaluation,
  candidates: readonly UnresolvedCandidate[],
  issues: LedgerIssue[],
  relationshipIds: ReadonlySet<string>,
): Draft[] {
  if (task.coverage.population !== "PER_SUBJECT_INSTANCE") return [];
  const subjectId = task.coverage.subjectEntityId;
  const verifiedIds = instancesOf(subjectId, evidence);
  const verified = new Set(verifiedIds);
  const unresolved = candidates.filter((candidate) => candidate.kind === "FIELD" && candidate.entityId === subjectId && (!candidate.instanceId || !verified.has(candidate.instanceId)));
  const drafts: Draft[] = unresolved.map((candidate) => candidateRow(task, candidate));
  if (verifiedIds.length === 0 && unresolved.length === 0) {
    drafts.push(noInstanceRow(task, evaluation, issues));
    return drafts;
  }
  const mode = adoptionMode(task);
  if (mode === "same") drafts.push(...sameInstanceRows(task, evaluation, verifiedIds, candidates, issues, relationshipIds));
  else if (mode === "cross") drafts.push(...crossRows(task, pack, evidence, evaluation, verifiedIds, candidates, issues, relationshipIds));
  else drafts.push(...withheldRows(task, evidence, verifiedIds, candidates));
  return drafts;
}

function onceDisposition(task: InvestigationTask): LedgerDisposition {
  if (task.taskKind === "DISABLED") return "DISABLED";
  if (task.taskKind === "NOTE_EXCEPTION" && task.deferred) return "DEFERRED";
  if (task.taskKind === "NOTE_UNSUPPORTED") return "UNSUPPORTED";
  return "NOT_EVALUATED";
}

function onceRows(task: InvestigationTask, pack: CompiledDomainPack, evidence: VerifiedCaseFacts, candidates: readonly UnresolvedCandidate[]): Draft[] {
  const belonging = candidates.filter((candidate) => belongsTo(task, candidate));
  const verifiedEntity = task.taskKind === "BIND_ENTITY" ? new Set(instancesOf(task.definitionId, evidence)) : new Set<string>();
  const related = belonging.filter((candidate) => task.taskKind !== "BIND_ENTITY" || !candidate.instanceId || !verifiedEntity.has(candidate.instanceId));
  const unresolvedIds = belonging.map((candidate) => candidate.candidateId);
  let instances: LedgerInstance[] = [];
  let supportingFactIds: string[] = [];
  let relationshipFactIds: string[] = [];
  let sourceRefs: VerifiedSourceRef[] = [];
  let missing: string[] = [];
  let extraReasons: string[] = [];
  if (task.taskKind === "BIND_ENTITY") {
    instances = instancesOf(task.definitionId, evidence).map((instanceId) => ({ entityId: task.definitionId, instanceId }));
    const facts = evidence.facts.filter((fact) => fact.entityId === task.definitionId);
    supportingFactIds = facts.map((fact) => fact.id);
    sourceRefs = facts.flatMap((fact) => fact.sourceRefs);
  }
  if (task.taskKind === "BIND_DOCUMENT") {
    const documents = evidence.documents.filter((document) => document.documentKindId === task.definitionId);
    supportingFactIds = documents.map((document) => document.id);
    sourceRefs = documents.flatMap((document) => document.sourceRefs);
    if (documents.length === 0) {
      missing = ["document:" + task.definitionId];
      extraReasons = ["DOCUMENT_MISSING"];
    }
  }
  if (task.taskKind === "BIND_RELATIONSHIP") {
    const links = evidence.relationships.filter((link) => link.relationshipId === task.definitionId);
    relationshipFactIds = links.map((link) => link.id);
    sourceRefs = links.flatMap((link) => link.sourceRefs);
    instances = links.flatMap((link) => endpointInstances(pack, link));
    const counts = new Map<string, number>();
    for (const link of links) {
      const key = relationshipKey(link.relationshipId, link.fromInstanceId, link.toInstanceId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if ([...counts.values()].some((count) => count > 1)) extraReasons = ["AMBIGUOUS_RELATIONSHIP"];
    if (links.length === 0) missing = [relationshipRequirement(task.definitionId)];
  }
  if (task.taskKind === "NOTE_OVERLAY" && (task.storedThreshold === null || task.comparisonRecorded === false)) {
    missing = ["storedThreshold"];
  }
  if (task.taskKind === "NOTE_UNSUPPORTED") extraReasons = ["OPERATOR_UNSUPPORTED"];
  const draft = base(task, "ONCE", onceDisposition(task), {
    instances,
    reasonCodes: extraReasons,
    supportingFactIds,
    relationshipFactIds,
    sourceRefs,
    missingRequirements: missing,
    unresolvedCandidateIds: unresolvedIds,
    ...(task.disabledReason ? { disabledReason: task.disabledReason } : {}),
    ...(task.evidenceForLink ? { evidenceForLink: task.evidenceForLink } : {}),
  });
  return [draft, ...related.map((candidate) => candidateRow(task, candidate))];
}

function endpointInstances(pack: CompiledDomainPack, link: VerifiedRelationshipFact): LedgerInstance[] {
  const definition = definitionOf(pack, link.relationshipId);
  if (definition?.kind !== "relationship") return [];
  return [
    { entityId: definition.fromEntityId, instanceId: link.fromInstanceId },
    { entityId: definition.toEntityId, instanceId: link.toInstanceId },
  ];
}

function belongsTo(task: InvestigationTask, candidate: UnresolvedCandidate): boolean {
  if (task.taskKind === "BIND_RELATIONSHIP" && candidate.kind === "RELATIONSHIP") return candidate.relationshipId === task.definitionId;
  if (task.taskKind === "BIND_DOCUMENT" && candidate.kind === "DOCUMENT") return candidate.documentKindId === task.definitionId;
  if (task.taskKind === "BIND_ENTITY" && candidate.kind === "FIELD") return candidate.entityId === task.definitionId;
  return false;
}

function unresolvedSubjectRow(task: InvestigationTask): Draft {
  return base(task, "UNRESOLVED_SUBJECT", "NOT_EVALUATED", { reasonCodes: codes("UNRESOLVED_SUBJECT", questionReason(task)) });
}

function presentationRow(row: DomainInvestigationPlan["presentation"][number]): Draft {
  return {
    taskId: "presentation:" + row.definitionId,
    taskKind: row.kind,
    definitionId: row.definitionId,
    population: "PRESENTATION",
    instances: [],
    disposition: "PRESENTATION",
    reasonCodes: [],
    authorities: row.authorities,
    supportingFactIds: [],
    relationshipFactIds: [],
    sourceRefs: [],
    missingRequirements: [],
  };
}

function standaloneCandidate(candidate: UnresolvedCandidate): Draft {
  const reviewRelationship = candidate.kind === "RELATIONSHIP" && candidate.trust === "REVIEW_REQUIRED";
  return {
    taskId: "unresolved:" + candidate.candidateId,
    taskKind: candidate.kind,
    definitionId: candidate.candidateId,
    population: "UNRESOLVED_INSTANCE",
    instances: candidateInstances(candidate),
    disposition: reviewRelationship ? "NOT_EVALUATED" : "UNRESOLVED_INSTANCE",
    reasonCodes: codes(candidate.reasons, reviewRelationship ? "REVIEW_REQUIRED" : undefined),
    authorities: [],
    supportingFactIds: [],
    relationshipFactIds: [],
    sourceRefs: [...candidate.sourceRefs],
    missingRequirements: [],
    candidateId: candidate.candidateId,
    candidateTrust: candidate.trust,
  };
}

function account(plan: DomainInvestigationPlan, evidence: VerifiedCaseFacts, candidates: readonly UnresolvedCandidate[], rows: readonly LedgerRow[], issues: LedgerIssue[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.rowId)) issue(issues, "duplicate_row", row.rowId, "Ledger row identity is duplicated.");
    seen.add(row.rowId);
    if (row.daysBetween !== undefined && row.disposition !== "COMPUTED") {
      issue(issues, "inconsistent_dp2", row.rowId, "A day count is recorded without a computed disposition.");
    }
    if (row.disposition === "COMPUTED" && row.daysBetween === undefined) {
      issue(issues, "inconsistent_dp2", row.rowId, "A computed row has no day count.");
    }
    if (row.candidateTrust === "REVIEW_REQUIRED" && row.relationshipFactIds.length > 0) {
      issue(issues, "relationship_promoted", row.rowId, "A review relationship was stored as a verified relationship.");
    }
  }
  for (const item of plan.presentation) {
    const matches = rows.filter((row) => row.definitionId === item.definitionId && row.population === "PRESENTATION");
    if (matches.length !== 1) issue(issues, "accounting_gap", item.definitionId, "Each presentation definition needs one coverage row.");
  }
  for (const task of plan.tasks) {
    const taskRows = rows.filter((row) => row.taskId === task.taskId);
    if (taskRows.length === 0) issue(issues, "accounting_gap", task.taskId, "Investigation task has no coverage row.");
    if (task.resultBinding) {
      const binding = task.resultBinding;
      const fromIds = instancesOf(binding.fromEntityId, evidence);
      const toIds = instancesOf(binding.toEntityId, evidence);
      const verifiedFrom = new Set(fromIds);
      const verifiedTo = new Set(toIds);
      const unresolved = candidates.filter((candidate) => endpointCandidate(candidate, binding.fromEntityId, verifiedFrom) || endpointCandidate(candidate, binding.toEntityId, verifiedTo));
      const noInstance = taskRows.filter((row) => row.population === "NO_INSTANCE");
      if (fromIds.length === 0 && toIds.length === 0 && unresolved.length === 0) {
        if (noInstance.length !== 1 || (noInstance[0]?.instances.length ?? 1) !== 0 || !noInstance[0]?.reasonCodes.includes("NO_INSTANCE")) {
          issue(issues, "accounting_gap", task.taskId, "A declared pair with no endpoint instance needs one NO_INSTANCE row.");
        }
      } else if (noInstance.length > 0) {
        issue(issues, "accounting_gap", task.taskId, "NO_INSTANCE cannot be combined with verified or unresolved endpoints.");
      }
      for (const instanceId of fromIds) {
        if (!taskRows.some((row) => row.instances.some((item) => item.entityId === binding.fromEntityId && item.instanceId === instanceId))) {
          issue(issues, "accounting_gap", task.taskId + ":" + instanceId, "Verified relationship endpoint is missing.");
        }
      }
      for (const instanceId of toIds) {
        if (!taskRows.some((row) => row.instances.some((item) => item.entityId === binding.toEntityId && item.instanceId === instanceId))) {
          issue(issues, "accounting_gap", task.taskId + ":" + instanceId, "Verified relationship endpoint is missing.");
        }
      }
      for (const candidate of unresolved) {
        if (!taskRows.some((row) => row.candidateId === candidate.candidateId && row.population === "UNRESOLVED_INSTANCE")) {
          issue(issues, "accounting_gap", task.taskId + ":" + candidate.candidateId, "Unresolved endpoint candidate is missing.");
        }
      }
      for (const row of taskRows) {
        if (row.disposition !== "COMPUTED") continue;
        const hasFrom = row.instances.some((item) => item.entityId === binding.fromEntityId);
        const hasTo = row.instances.some((item) => item.entityId === binding.toEntityId);
        if (!hasFrom || !hasTo || row.relationshipFactIds.length === 0) {
          issue(issues, "inconsistent_dp2", row.rowId, "A computed pair is missing a declared endpoint or relationship.");
        }
      }
    } else if (task.coverage.population === "UNRESOLVED_SUBJECT") {
      if (taskRows.length !== 1 || taskRows[0]?.population !== "UNRESOLVED_SUBJECT" || (taskRows[0]?.instances.length ?? 1) !== 0) {
        issue(issues, "accounting_gap", task.taskId, "An unresolved subject needs one row and no evaluated instance.");
      }
    }
    if (task.coverage.population === "ONCE" && !taskRows.some((row) => row.population === "ONCE")) {
      issue(issues, "accounting_gap", task.taskId, "A once-per-definition task needs its accounting row.");
    }
    if (!task.resultBinding && task.coverage.population === "PER_SUBJECT_INSTANCE") {
      const subjectEntityId = task.coverage.subjectEntityId;
      const verifiedIds = instancesOf(subjectEntityId, evidence);
      const verified = new Set(verifiedIds);
      const unresolved = candidates.filter((candidate) => candidate.kind === "FIELD" && candidate.entityId === subjectEntityId && (!candidate.instanceId || !verified.has(candidate.instanceId)));
      const noInstance = taskRows.filter((row) => row.population === "NO_INSTANCE");
      if (verifiedIds.length === 0 && unresolved.length === 0) {
        if (noInstance.length !== 1 || (noInstance[0]?.instances.length ?? 1) !== 0 || !noInstance[0]?.reasonCodes.includes("NO_INSTANCE")) {
          issue(issues, "accounting_gap", task.taskId, "A subject with no instance needs one NO_INSTANCE row.");
        }
      } else if (noInstance.length > 0) {
        issue(issues, "accounting_gap", task.taskId, "NO_INSTANCE cannot be combined with verified or unresolved instances.");
      }
      for (const instanceId of verifiedIds) {
        if (!taskRows.some((row) => row.instances.some((item) => item.entityId === subjectEntityId && item.instanceId === instanceId))) {
          issue(issues, "accounting_gap", task.taskId + ":" + instanceId, "Verified subject instance is missing.");
        }
      }
      for (const candidate of unresolved) {
        if (!taskRows.some((row) => row.candidateId === candidate.candidateId && row.population === "UNRESOLVED_INSTANCE")) {
          issue(issues, "accounting_gap", task.taskId + ":" + candidate.candidateId, "Unresolved subject candidate is missing.");
        }
      }
    }
    for (const row of taskRows) {
      if (AFFIRMATIVE.has(row.disposition) && (!task.dp2Eligible || row.population !== "VERIFIED_INSTANCE")) {
        issue(issues, "inconsistent_dp2", row.rowId, "An affirmative disposition is not tied to an eligible verified instance.");
      }
      if ((row.population === "NO_INSTANCE" || row.population === "UNRESOLVED_SUBJECT" || row.population === "PRESENTATION") && row.daysBetween !== undefined) {
        issue(issues, "inconsistent_dp2", row.rowId, "This population cannot carry a day count.");
      }
    }
  }
  const referenced = new Set<string>();
  for (const row of rows) {
    if (row.candidateId) referenced.add(row.candidateId);
    for (const candidateId of row.unresolvedCandidateIds ?? []) referenced.add(candidateId);
  }
  for (const candidate of candidates) {
    if (!referenced.has(candidate.candidateId)) issue(issues, "accounting_gap", candidate.candidateId, "Unresolved candidate is missing from the ledger.");
  }
}

function agree(plan: DomainInvestigationPlan, evaluation: ReadyEvaluation, rows: readonly LedgerRow[], relationshipIds: ReadonlySet<string>, issues: LedgerIssue[]): void {
  for (const task of plan.tasks) {
    if (task.taskKind === "REVIEW_CHECK") {
      const affirmed = resultsFor(evaluation, task.definitionId).some((result) => result.outcome === "ESTABLISHED" || result.outcome === "NOT_SATISFIED" || result.outcome === "COMPUTED" || result.daysBetween !== undefined);
      if (affirmed) issue(issues, "inconsistent_dp2", task.taskId, "A review check was evaluated as a conclusion.");
    }
    const mode = adoptionMode(task);
    if (mode === "none") continue;
    const taskRows = rows.filter((row) => row.taskId === task.taskId && row.population === "VERIFIED_INSTANCE" && !row.candidateId);
    const results = resultsFor(evaluation, task.definitionId).filter((result) => result.instances.length > 0);
    if (mode === "cross" || mode === "pair") {
      for (const result of results) {
        const match = taskRows.find((row) => instanceKey(row.instances) === instanceKey(result.instances));
        if (!match || !sameResult(match, result, relationshipIds)) {
          issue(issues, "inconsistent_dp2", task.taskId, "Cross-entity ledger row does not match DP-2.");
        }
      }
      continue;
    }
    for (const result of results) {
      const match = taskRows.find((row) => instanceKey(row.instances) === instanceKey(result.instances));
      if (!match || !sameResult(match, result, relationshipIds)) {
        issue(issues, "inconsistent_dp2", task.taskId, "Same-instance ledger row does not match DP-2.");
      }
    }
  }
}

function sameResult(row: LedgerRow, result: DomainRuleResult, relationshipIds: ReadonlySet<string>): boolean {
  if (row.disposition !== result.outcome) return false;
  if ((row.daysBetween ?? "") !== (result.daysBetween ?? "")) return false;
  const support = splitSupport(result, relationshipIds);
  const left = sortIds([...row.supportingFactIds, ...row.relationshipFactIds]).join("\0");
  const right = sortIds([...support.supportingFactIds, ...support.relationshipFactIds]).join("\0");
  return left === right;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) freezeDeep(child);
  }
  return value;
}

function promoted(evidence: VerifiedCaseFacts, candidates: readonly UnresolvedCandidate[]): boolean {
  const held = candidates.filter((candidate) => candidate.kind === "RELATIONSHIP" && candidate.relationshipId && candidate.fromInstanceId && candidate.toInstanceId);
  return evidence.relationships.some((link) => {
    const linkRefs = link.sourceRefs.map(refKey);
    if (linkRefs.length === 0) return false;
    return held.some((candidate) => {
      if (candidate.relationshipId !== link.relationshipId || candidate.fromInstanceId !== link.fromInstanceId || candidate.toInstanceId !== link.toInstanceId) return false;
      const candidateRefs = new Set(candidate.sourceRefs.map(refKey));
      return linkRefs.every((key) => candidateRefs.has(key));
    });
  });
}

/**
 * Builds the case coverage ledger for one compiled plan and one verified evidence set.
 * Mismatched digests, a promoted relationship, a missing task row, a duplicate row identity,
 * or a DP-2 result that disagrees with an adopted row fail closed and return no ledger.
 */
export function buildCoverageLedger(input: CoverageLedgerInput): CoverageLedgerResult {
  const issues: LedgerIssue[] = [];
  if (!isObject(input?.plan) || input.plan.schema !== DOMAIN_INVESTIGATION_PLAN_SCHEMA || !input.plan.digest) {
    issue(issues, "plan_required", "$.plan", "Coverage starts from a compiled investigation plan.");
  }
  if (!isObject(input?.pack) || input.pack.schema !== DOMAIN_PACK_RUNTIME_SCHEMA || !input.pack.identity?.digest) {
    issue(issues, "pack_snapshot_required", "$.pack", "Coverage starts from a compiled domain-pack snapshot.");
  }
  if (!isObject(input?.verified) || input.verified.schema !== VERIFIED_CASE_FACTS_SCHEMA || !Array.isArray(input.verified.facts) || !Array.isArray(input.verified.documents) || !Array.isArray(input.verified.relationships) || !Array.isArray(input.verified.conflicts)) {
    issue(issues, "evidence_invalid", "$.verified", "Coverage reads only verified case facts.");
  }
  if (!isObject(input?.unresolved) || input.unresolved.schema !== UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA || !Array.isArray(input.unresolved.candidates)) {
    issue(issues, "unresolved_invalid", "$.unresolved", "Unresolved candidates must be an explicit list.");
  }
  if (issues.length || !input?.plan || !input.pack || !input.verified || !input.unresolved) return fail(issues);

  if (input.plan.pack.digest !== input.pack.identity.digest) {
    issue(issues, "digest_mismatch", "$.plan.pack.digest", "The plan digest is not pinned to this compiled pack.");
  }
  if (input.plan.pack.packId !== input.pack.identity.packId || input.plan.pack.version !== input.pack.identity.version) {
    issue(issues, "pack_mismatch", "$.plan.pack", "The plan edition does not match this compiled pack.");
  }
  const seenCandidates = new Set<string>();
  for (const candidate of input.unresolved.candidates) {
    if (!candidate?.candidateId || seenCandidates.has(candidate.candidateId)) {
      issue(issues, "duplicate_row", "$.unresolved." + (candidate?.candidateId ?? ""), "Unresolved candidate ids must be unique.");
    }
    if (candidate?.candidateId) seenCandidates.add(candidate.candidateId);
  }
  const evidence = canonicalizeEvidence(input.verified, input.unresolved);
  if (investigationEvidenceDigest(evidence.verified, evidence.unresolved) !== input.evidenceDigest) {
    issue(issues, "digest_mismatch", "$.evidenceDigest", "Evidence digest does not match the verified facts and unresolved candidates.");
  }
  if (promoted(evidence.verified, evidence.unresolved.candidates)) {
    issue(issues, "relationship_promoted", "$.verified.relationships", "An unresolved relationship candidate was also supplied as a verified relationship.");
  }
  if (issues.length) return fail(issues);

  const evaluation = evaluateDomainRules(input.pack, evidence.verified);
  if (!evaluation.ok) return fail(evaluation.issues);
  const relationshipIds = new Set(evidence.verified.relationships.map((link) => link.id));
  const drafts: Draft[] = input.plan.presentation.map((row) => presentationRow(row));
  const attached = new Set<string>();
  for (const task of input.plan.tasks) {
    const produced = task.resultBinding
      ? pairRows(task, input.pack, evidence.verified, evaluation, evidence.unresolved.candidates, issues, relationshipIds)
      : task.coverage.population === "PER_SUBJECT_INSTANCE"
        ? subjectRows(task, input.pack, evidence.verified, evaluation, evidence.unresolved.candidates, issues, relationshipIds)
        : task.coverage.population === "UNRESOLVED_SUBJECT"
          ? [unresolvedSubjectRow(task)]
          : onceRows(task, input.pack, evidence.verified, evidence.unresolved.candidates);
    if (produced.length === 0) issue(issues, "accounting_gap", task.taskId, "Task coverage population is not accounted for.");
    for (const draft of produced) {
      if (draft.candidateId) attached.add(draft.candidateId);
      for (const candidateId of draft.unresolvedCandidateIds ?? []) attached.add(candidateId);
    }
    drafts.push(...produced);
  }
  for (const candidate of evidence.unresolved.candidates) {
    if (!attached.has(candidate.candidateId)) drafts.push(standaloneCandidate(candidate));
  }
  const rows = drafts.map((draft) => finish(input.plan, draft)).sort((left, right) => left.rowId.localeCompare(right.rowId));
  account(input.plan, evidence.verified, evidence.unresolved.candidates, rows, issues);
  agree(input.plan, evaluation, rows, relationshipIds, issues);
  if (issues.length) return fail(issues);

  const body = {
    schema: DOMAIN_INVESTIGATION_LEDGER_SCHEMA,
    ledgerVersion: DOMAIN_INVESTIGATION_LEDGER_VERSION,
    planDigest: input.plan.digest,
    evidenceDigest: input.evidenceDigest,
    packDigest: input.pack.identity.digest,
    plannerVersion: input.plan.plannerVersion,
    pack: input.plan.pack,
    ownership: input.plan.ownership,
    applicability: input.plan.applicability,
    ...(input.plan.upstream ? { upstream: input.plan.upstream } : {}),
    supplemental: input.plan.supplemental,
    evidenceCoverage: evidence.verified.coverage,
    taskAccountingComplete: true as const,
    rows,
  };
  return { ok: true, value: freezeDeep({ ...body, digest: packDigest(body) }) };
}
