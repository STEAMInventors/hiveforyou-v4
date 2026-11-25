import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDomainPack, packDigest } from "./domain-pack-compiler";
import {
  authorizedExtractionDigest,
  bindInvestigationCandidates,
  INVESTIGATION_CANDIDATES_SCHEMA,
  UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA,
  type UnresolvedCandidate,
  type UnresolvedCandidates,
} from "./domain-investigation-binder";
import { compileInvestigationPlan, type InvestigationPlanInput, type SupplementalArtifacts } from "./domain-investigation-plan";
import {
  buildCoverageLedger,
  investigationEvidenceDigest,
  type DomainInvestigationLedger,
} from "./domain-investigation-ledger";
import { evaluateDomainRules, VERIFIED_CASE_FACTS_SCHEMA, type VerifiedCaseFacts, type VerifiedFact, type VerifiedRelationshipFact } from "./domain-pack-rules";
import { DOMAIN_PACK_SOURCE_SCHEMA, type CompiledDomainPack, type DomainPackSource, type PackDefinition } from "./domain-pack-source";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";

const ROOT = join(import.meta.dirname, "../../../../packs/drafts/iep-us-federal/v0.3.0");
const PINS = {
  ontology: "60e096187cbc44346ec78b76648edd4fcd159e407d0ec1d60000d62610455fd8",
  authorityRegister: "b7175fb6a54aa5085bbba9c63e9c0827fd4dab1858f12a5e25c36946c3018f74",
  conflictPatterns: "85586cfd6356397e775ed2e89f3a7c0b7f1c5c106e2111d308c5d6dd0fc1767f",
  stateOverlays: "928f6b91eb0baff422908aec0b5ac955403b8b1764539a6149c85c70043e787f",
  factClasses: "9ec53126bb258fbad2d956744b3681a20b93b830ef697cc1b627ef748a67b6b9",
  workflowCoverage: "1ec87d6129888c48aa96918178a854a1009c17a483b747aabec0e8d478774311",
  unsupportedOperators: "44f1e486331b68d09c03f1f9499e1808699e5aec9ecddea0b09e034b7e38389d",
} as const;

const CALCULATIONS = [
  { id: "calculation:C1", relationshipId: "relationship:consent-authorizes-evaluation", start: ["entity:consent", "receivedDate"], end: ["entity:evaluation", "completionDate"] },
  { id: "calculation:C2", relationshipId: "relationship:eligibility-precedes-iep", start: ["entity:eligibility-determination", "determinationDate"], end: ["entity:iep", "meetingDate"] },
  { id: "calculation:C3", relationshipId: "relationship:iep-contains-service", start: ["entity:iep", "meetingDate"], end: ["entity:service", "startDate"] },
  { id: "calculation:C14", relationshipId: null, start: ["entity:records-request", "requestDate"], end: ["entity:records-request", "responseDate"] },
  { id: "calculation:C15", relationshipId: "relationship:notice-for-meeting", start: ["entity:meeting-notice", "noticeDate"], end: ["entity:iep-meeting", "meetingDate"] },
  { id: "calculation:C20", relationshipId: null, start: ["entity:iee-request", "requestDate"], end: ["entity:iee-request", "agencyResponseDate"] },
  { id: "calculation:C21", relationshipId: "relationship:evaluation-supports-eligibility", start: ["entity:evaluation", "completionDate"], end: ["entity:eligibility-determination", "determinationDate"] },
] as const;

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, name), "utf8")) as unknown;
}

function proofInput(): InvestigationPlanInput {
  const source = loadJson("iep-domain-pack-source.stage4b.json") as DomainPackSource;
  const compiled = compileDomainPack(source);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
  return {
    pack: compiled.value,
    artifacts: {
      ontology: loadJson("iep-domain-ontology-spec.json"),
      authorityRegister: loadJson("iep-domain-authority-register.json"),
      conflictPatterns: loadJson("iep-domain-conflict-patterns.v1.json"),
      stateOverlays: loadJson("iep-domain-state-overlays.v1.json"),
      factClasses: loadJson("iep-domain-fact-classes.v1.json"),
      workflowCoverage: loadJson("iep-domain-workflow-coverage.v1.json"),
      unsupportedOperators: loadJson("iep-domain-unsupported-operators.v1.json"),
    },
    digests: PINS,
  };
}

function proof() {
  const input = proofInput();
  const plan = compileInvestigationPlan(input);
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  return { pack: input.pack, plan: plan.value };
}

function none(): UnresolvedCandidates {
  return { schema: UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA, candidates: [] };
}

function facts(coverage: VerifiedCaseFacts["coverage"], rows: VerifiedFact[], relationships: VerifiedRelationshipFact[] = []): VerifiedCaseFacts {
  return { schema: VERIFIED_CASE_FACTS_SCHEMA, coverage, facts: rows, documents: [], relationships, conflicts: [] };
}

function dateFact(id: string, entityId: string, instanceId: string, fieldId: string, value: string, documentId: string, page: string): VerifiedFact {
  return { id, status: "VERIFIED", entityId, instanceId, fieldId, value: { valueType: "DATE", value }, sourceRefs: [{ documentId, page }] };
}

function textFact(id: string, entityId: string, instanceId: string, fieldId: string, value: string, documentId: string): VerifiedFact {
  return { id, status: "VERIFIED", entityId, instanceId, fieldId, value: { valueType: "TEXT", value }, sourceRefs: [{ documentId, page: "1" }] };
}

function link(id: string, relationshipId: string, fromInstanceId: string, toInstanceId: string, documentId: string, page = "3"): VerifiedRelationshipFact {
  return { id, status: "VERIFIED", relationshipId, fromInstanceId, toInstanceId, sourceRefs: [{ documentId, page }] };
}

function ledgerFor(pack: CompiledDomainPack, plan: ReturnType<typeof proof>["plan"], verified: VerifiedCaseFacts, unresolved = none()) {
  return buildCoverageLedger({
    plan,
    pack,
    verified,
    unresolved,
    evidenceDigest: investigationEvidenceDigest(verified, unresolved),
  });
}

function openLedger(pack: CompiledDomainPack, plan: ReturnType<typeof proof>["plan"], verified: VerifiedCaseFacts, unresolved = none()): DomainInvestigationLedger {
  const result = ledgerFor(pack, plan, verified, unresolved);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function rowsFor(value: DomainInvestigationLedger, definitionId: string) {
  return value.rows.filter((row) => row.definitionId === definitionId);
}

function span(spec: (typeof CALCULATIONS)[number], prefix: string, start: string, end: string | null) {
  const same = spec.relationshipId === null;
  const startInstance = same ? prefix : prefix + "-from";
  const endInstance = same ? prefix : prefix + "-to";
  const built = [dateFact(prefix + "-start", spec.start[0], startInstance, spec.start[1], start, prefix + "-start-doc", "1")];
  if (end !== null) built.push(dateFact(prefix + "-end", spec.end[0], endInstance, spec.end[1], end, prefix + "-end-doc", "2"));
  const links = spec.relationshipId ? [link(prefix + "-link", spec.relationshipId, startInstance, endInstance, prefix + "-link-doc")] : [];
  return { facts: built, links, startInstance, endInstance };
}

describe("investigation coverage ledger", () => {
  const { pack, plan } = proof();

  it("does not name a profession in the ledger implementation", () => {
    const source = readFileSync(join(import.meta.dirname, "domain-investigation-ledger.ts"), "utf8");
    expect(source).not.toMatch(/calculation:C\d/);
    expect(source).not.toMatch(/check:G\d/);
    expect(source).not.toMatch(/iep-us-federal/i);
  });

  it("accounts for every task when the case has no instances", () => {
    const value = openLedger(pack, plan, facts("INCOMPLETE", []));
    expect(value.schema).toBe("hive.domain-investigation-ledger/1");
    expect(value.planDigest).toBe(plan.digest);
    expect(value.packDigest).toBe(pack.identity.digest);
    expect(value.pack).toMatchObject({ packId: "iep-us-federal", version: "0.3.0", publication: "UNPUBLISHED", reviewStatus: "DRAFT" });
    expect(value.evidenceCoverage).toBe("INCOMPLETE");
    expect(value.taskAccountingComplete).toBe(true);
    expect(value.rows.filter((row) => row.population === "PRESENTATION")).toHaveLength(27);
    for (const task of plan.tasks) {
      expect(value.rows.some((row) => row.taskId === task.taskId)).toBe(true);
    }
    const checks = plan.tasks.filter((task) => task.taskKind === "REVIEW_CHECK");
    expect(checks).toHaveLength(67);
    for (const task of checks) {
      const rows = rowsFor(value, task.definitionId);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.disposition === "NOT_EVALUATED" && row.reasonCodes.includes("REVIEW_REQUIRED") && row.daysBetween === undefined)).toBe(true);
      expect(rows.some((row) => row.disposition === "ESTABLISHED" || row.disposition === "NOT_SATISFIED" || row.disposition === "COMPUTED")).toBe(false);
    }
    expect(value.rows.some((row) => row.disposition === "ESTABLISHED" || row.disposition === "COMPUTED" || "verdict" in row || "legalConclusion" in row)).toBe(false);
    expect(rowsFor(value, "check:G2")).toEqual([expect.objectContaining({ population: "NO_INSTANCE", disposition: "NOT_EVALUATED", instances: [], reasonCodes: expect.arrayContaining(["NO_INSTANCE", "REVIEW_REQUIRED"]) })]);
    for (const spec of CALCULATIONS) {
      const row = rowsFor(value, spec.id)[0];
      expect(row?.daysBetween).toBeUndefined();
      expect(row?.disposition === "NOT_EVALUATED" || row?.disposition === "UNSUPPORTED").toBe(true);
    }
    const deferred = value.rows.filter((row) => row.disposition === "DEFERRED");
    expect(deferred.map((row) => row.definitionId).sort()).toEqual(["workflowCoverage:discipline", "workflowCoverage:preschool-part-c-transition"]);
    expect(value.rows.filter((row) => row.taskKind === "NOTE_UNSUPPORTED").every((row) => row.disposition === "UNSUPPORTED" && row.reasonCodes.includes("OPERATOR_UNSUPPORTED"))).toBe(true);
    expect(value.rows.filter((row) => row.population === "PRESENTATION").every((row) => row.disposition === "PRESENTATION")).toBe(true);
    const again = openLedger(pack, plan, facts("INCOMPLETE", []));
    expect(again.digest).toBe(value.digest);
    expect(again.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps goal instances independent and preserves unresolved candidates", () => {
    const verified = facts("INCOMPLETE", [
      textFact("goal-1", "entity:annual-goal", "goal-a", "goalText", "Read the first passage", "doc-a"),
      textFact("goal-2", "entity:annual-goal", "goal-b", "goalText", "Read the second passage", "doc-b"),
    ]);
    const unresolved: UnresolvedCandidates = {
      schema: UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA,
      candidates: [{
        candidateId: "goal-open",
        kind: "FIELD",
        trust: "UNRESOLVED",
        reasons: ["QUOTE_NOT_FOUND"],
        entityId: "entity:annual-goal",
        instanceId: "goal-c",
        fieldId: "goalText",
        sourceRefs: [{ documentId: "doc-c", page: "4" }],
        evidence: [],
      }],
    };
    const value = openLedger(pack, plan, verified, unresolved);
    const goals = rowsFor(value, "check:G2").filter((row) => row.population !== "ONCE");
    expect(goals.map((row) => row.population).sort()).toEqual(["UNRESOLVED_INSTANCE", "VERIFIED_INSTANCE", "VERIFIED_INSTANCE"]);
    expect(goals.some((row) => row.population === "NO_INSTANCE")).toBe(false);
    const verifiedRows = goals.filter((row) => row.population === "VERIFIED_INSTANCE");
    expect(verifiedRows.map((row) => row.instances)).toEqual([
      [{ entityId: "entity:annual-goal", instanceId: "goal-a" }],
      [{ entityId: "entity:annual-goal", instanceId: "goal-b" }],
    ]);
    expect(verifiedRows[0]?.supportingFactIds).toEqual(["goal-1"]);
    expect(verifiedRows[1]?.supportingFactIds).toEqual(["goal-2"]);
    expect(verifiedRows.every((row) => row.disposition === "NOT_EVALUATED" && row.reasonCodes.includes("REVIEW_REQUIRED"))).toBe(true);
    expect(goals.find((row) => row.candidateId === "goal-open")).toMatchObject({
      population: "UNRESOLVED_INSTANCE",
      disposition: "UNRESOLVED_INSTANCE",
      instances: [{ entityId: "entity:annual-goal", instanceId: "goal-c" }],
      relationshipFactIds: [],
    });
    expect(value.rows.filter((row) => row.taskKind === "REVIEW_CHECK").every((row) => (row.disposition === "NOT_EVALUATED" || row.disposition === "UNRESOLVED_INSTANCE") && row.reasonCodes.includes("REVIEW_REQUIRED") && row.daysBetween === undefined)).toBe(true);
  });

  it("computes a day count for every executable calculation that has its declared inputs", () => {
    const built = CALCULATIONS.map((spec) => span(spec, spec.id, "2024-01-01", "2024-01-11"));
    const verified = facts("COMPLETE", built.flatMap((item) => item.facts), built.flatMap((item) => item.links));
    const direct = evaluateDomainRules(pack, verified);
    if (!direct.ok) throw new Error(JSON.stringify(direct.issues));
    const value = openLedger(pack, plan, verified);
    for (const spec of CALCULATIONS) {
      const task = plan.tasks.find((item) => item.definitionId === spec.id);
      const row = rowsFor(value, spec.id).find((item) => item.disposition === "COMPUTED");
      const engine = direct.results.find((item) => item.ruleId === spec.id && item.outcome === "COMPUTED");
      expect(task?.dp2Eligible).toBe(true);
      expect(engine?.daysBetween).toBe("10");
      if (spec.relationshipId === null) {
        expect(row).toMatchObject({
          population: "VERIFIED_INSTANCE",
          disposition: "COMPUTED",
          daysBetween: "10",
          instances: [{ entityId: spec.start[0], instanceId: spec.id }],
          supportingFactIds: [spec.id + "-end", spec.id + "-start"],
        });
        expect(row?.relationshipFactIds).toEqual([]);
        expect(row?.reasonCodes).toContain("CALCULATION_COMPUTED");
      } else {
        expect(row).toMatchObject({
          disposition: "COMPUTED",
          daysBetween: "10",
          relationshipFactIds: [spec.id + "-link"],
          supportingFactIds: [spec.id + "-end", spec.id + "-start"],
        });
        expect(row?.sourceRefs.map((ref) => ref.documentId).sort()).toEqual([spec.id + "-end-doc", spec.id + "-link-doc", spec.id + "-start-doc"]);
      }
      expect(row?.authorityGate).toEqual(expect.arrayContaining(["PUBLICATION_UNPUBLISHED", "UNVERIFIED_APPLICABILITY"]));
      if (task?.authorities.some((authority) => authority.unreviewed)) expect(row?.authorityGate).toContain("UNREVIEWED_AUTHORITY");
      expect(row && "verdict" in row).toBe(false);
    }
    expect(value.rows.filter((row) => row.taskKind === "REVIEW_CHECK").every((row) => row.disposition === "NOT_EVALUATED")).toBe(true);
  });

  it("keeps one row per declared endpoint pair, including one-to-many", () => {
    const builtFacts: VerifiedFact[] = [];
    const builtLinks: VerifiedRelationshipFact[] = [];
    for (const spec of CALCULATIONS) {
      if (spec.relationshipId === null) {
        for (const [suffix, end] of [["a", "2024-01-11"], ["b", "2024-01-21"]] as const) {
          const instanceId = spec.id + "-" + suffix;
          builtFacts.push(
            dateFact(instanceId + "-start", spec.start[0], instanceId, spec.start[1], "2024-01-01", instanceId + "-doc", "1"),
            dateFact(instanceId + "-end", spec.end[0], instanceId, spec.end[1], end, instanceId + "-doc", "2"),
          );
        }
        continue;
      }
      const fromId = spec.id + "-from";
      builtFacts.push(dateFact(spec.id + "-start", spec.start[0], fromId, spec.start[1], "2024-01-01", spec.id + "-start-doc", "1"));
      for (const [suffix, end] of [["a", "2024-01-11"], ["b", "2024-01-21"], ["c", "2024-02-01"]] as const) {
        const toId = spec.id + "-to-" + suffix;
        builtFacts.push(dateFact(spec.id + "-end-" + suffix, spec.end[0], toId, spec.end[1], end, spec.id + "-" + suffix + "-doc", "2"));
        if (suffix !== "c") builtLinks.push(link(spec.id + "-link-" + suffix, spec.relationshipId, fromId, toId, spec.id + "-link-" + suffix + "-doc"));
      }
    }
    builtLinks.push(link("calculation:C1-reverse", "relationship:consent-authorizes-evaluation", "calculation:C1-to-a", "calculation:C1-from", "calculation:C1-reverse-doc"));
    const value = openLedger(pack, plan, facts("COMPLETE", builtFacts, builtLinks));
    for (const spec of CALCULATIONS) {
      const rows = rowsFor(value, spec.id);
      const computed = rows.filter((row) => row.disposition === "COMPUTED");
      expect(computed.map((row) => row.daysBetween).sort()).toEqual(["10", "20"]);
      expect(computed.every((row) => row.population === "VERIFIED_INSTANCE" && !("verdict" in row))).toBe(true);
      if (spec.relationshipId === null) {
        expect(computed.map((row) => row.instances.map((item) => item.instanceId).join(",")).sort()).toEqual([spec.id + "-a", spec.id + "-b"]);
        expect(computed.every((row) => row.relationshipFactIds.length === 0)).toBe(true);
        continue;
      }
      const fromId = spec.id + "-from";
      expect(computed.map((row) => row.relationshipFactIds)).toEqual(expect.arrayContaining([[spec.id + "-link-a"], [spec.id + "-link-b"]]));
      for (const row of computed) {
        expect(row.instances).toEqual(expect.arrayContaining([
          { entityId: spec.start[0], instanceId: fromId },
          expect.objectContaining({ entityId: spec.end[0] }),
        ]));
        const tos = row.instances.filter((item) => item.entityId === spec.end[0]).map((item) => item.instanceId);
        expect(tos).toHaveLength(1);
        expect(tos[0] === spec.id + "-to-c").toBe(false);
      }
      const open = rows.find((row) => row.instances.some((item) => item.instanceId === spec.id + "-to-c"));
      expect(open).toMatchObject({
        disposition: "NOT_EVALUATED",
        instances: [{ entityId: spec.end[0], instanceId: spec.id + "-to-c" }],
        relationshipFactIds: [],
      });
      expect(open?.daysBetween).toBeUndefined();
      expect(open?.missingRequirements).toContain(spec.relationshipId);
      expect(open?.missingRequirements.some((item) => item.startsWith("relationship:relationship:"))).toBe(false);
      expect(rows.some((row) => row.population === "UNRESOLVED_SUBJECT")).toBe(false);
    }
    expect(rowsFor(value, "calculation:C1").filter((row) => row.disposition === "COMPUTED")).toHaveLength(2);
  });

  it("does not compute a cross-entity day count without a verified relationship", () => {
    const built = CALCULATIONS.map((spec) => span(spec, spec.id, "2024-01-01", "2024-01-11"));
    const value = openLedger(pack, plan, facts("COMPLETE", built.flatMap((item) => item.facts)));
    for (const spec of CALCULATIONS) {
      const rows = rowsFor(value, spec.id).filter((item) => item.population === "VERIFIED_INSTANCE");
      if (spec.relationshipId === null) {
        expect(rows).toEqual([expect.objectContaining({ disposition: "COMPUTED", daysBetween: "10" })]);
      } else {
        expect(rows.some((row) => row.disposition === "COMPUTED" || row.daysBetween !== undefined)).toBe(false);
        const own = rows.filter((row) => row.instances.some((item) => item.instanceId === spec.id + "-from" || item.instanceId === spec.id + "-to"));
        expect(own).toHaveLength(2);
        expect(own.every((row) => row.disposition === "NOT_EVALUATED" && row.relationshipFactIds.length === 0)).toBe(true);
        expect(own.every((row) => row.missingRequirements.includes(spec.relationshipId) && row.reasonCodes.includes("CROSS_ENTITY"))).toBe(true);
      }
    }
    expect(value.rows.some((row) => row.missingRequirements.some((item) => item.startsWith("relationship:relationship:")))).toBe(false);
  });

  it("keeps a missing date, an ambiguous link, and a second instance separate", () => {
    const missing = span(CALCULATIONS[5], "c20", "2024-03-01", null);
    const ambiguous = span(CALCULATIONS[2], "c3", "2024-01-01", "2024-01-11");
    const second = span(CALCULATIONS[3], "rr-2", "2024-06-01", "2024-06-15");
    const first = span(CALCULATIONS[3], "rr-1", "2024-01-01", "2024-01-11");
    const otherService = [dateFact("service-b", "entity:service", "service-b", "startDate", "2024-02-01", "service-b-doc", "2")];
    const verified = facts("COMPLETE", [...missing.facts, ...ambiguous.facts, ...first.facts, ...second.facts, ...otherService], [
      link("c3-a", "relationship:iep-contains-service", ambiguous.startInstance, ambiguous.endInstance, "c3-link-a", "3"),
      link("c3-b", "relationship:iep-contains-service", ambiguous.startInstance, ambiguous.endInstance, "c3-link-b", "4"),
    ]);
    const value = openLedger(pack, plan, verified);
    const c20 = rowsFor(value, "calculation:C20").find((row) => row.population === "VERIFIED_INSTANCE");
    expect(c20?.disposition).toBe("NOT_EVALUATED");
    expect(c20?.daysBetween).toBeUndefined();
    expect(c20?.reasonCodes).toContain("FIELD_MISSING");
    const c3 = rowsFor(value, "calculation:C3").filter((row) => row.population === "VERIFIED_INSTANCE");
    expect(c3.every((row) => row.daysBetween === undefined && row.disposition === "NOT_EVALUATED")).toBe(true);
    expect(c3.some((row) => row.reasonCodes.includes("AMBIGUOUS_RELATIONSHIP"))).toBe(true);
    expect(c3.find((row) => row.reasonCodes.includes("AMBIGUOUS_RELATIONSHIP"))?.relationshipFactIds).toEqual(["c3-a", "c3-b"]);
    const requests = rowsFor(value, "calculation:C14").filter((row) => row.population === "VERIFIED_INSTANCE");
    expect(requests.map((row) => [row.instances[0]?.instanceId, row.daysBetween]).sort()).toEqual([["rr-1", "10"], ["rr-2", "14"]]);
    expect(requests.find((row) => row.instances[0]?.instanceId === "rr-1")?.supportingFactIds).toEqual(["rr-1-end", "rr-1-start"]);
    expect(requests.find((row) => row.instances[0]?.instanceId === "rr-2")?.supportingFactIds).toEqual(["rr-2-end", "rr-2-start"]);
    expect(c3.some((row) => row.instances.some((item) => item.instanceId === "service-b") && row.reasonCodes.includes("CROSS_ENTITY"))).toBe(true);
  });

  it("keeps task accounting when documents are missing", () => {
    const built = span(CALCULATIONS[3], "rr", "2024-01-01", "2024-01-11");
    const value = openLedger(pack, plan, facts("INCOMPLETE", built.facts));
    expect(value.evidenceCoverage).toBe("INCOMPLETE");
    expect(value.taskAccountingComplete).toBe(true);
    expect(rowsFor(value, "calculation:C14")[0]).toMatchObject({ disposition: "COMPUTED", daysBetween: "10" });
    expect(rowsFor(value, "calculation:C14")[0]?.reasonCodes).toContain("INCOMPLETE_COVERAGE");
    const document = value.rows.find((row) => row.taskKind === "BIND_DOCUMENT" && row.population === "ONCE");
    expect(document?.reasonCodes).toContain("DOCUMENT_MISSING");
    expect(document?.missingRequirements[0]).toMatch(/^document:/);
    expect(plan.tasks.every((task) => value.rows.some((row) => row.taskId === task.taskId))).toBe(true);
  });

  it("fails closed on a mismatched digest, a promoted relationship, a duplicate identity, and an unbound fact", () => {
    const verified = facts("COMPLETE", []);
    const mismatch = buildCoverageLedger({
      plan,
      pack,
      verified,
      unresolved: none(),
      evidenceDigest: "ab".repeat(32),
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.issues.some((item) => item.code === "digest_mismatch")).toBe(true);
      expect("value" in mismatch).toBe(false);
    }
    const shifted = structuredClone(plan);
    shifted.pack = { ...shifted.pack, digest: "cd".repeat(32) };
    const packMismatch = ledgerFor(pack, shifted, verified);
    expect(packMismatch.ok).toBe(false);
    if (!packMismatch.ok) expect(packMismatch.issues.some((item) => item.code === "digest_mismatch")).toBe(true);

    const unresolved: UnresolvedCandidates = {
      schema: UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA,
      candidates: [{
        candidateId: "held-link",
        kind: "RELATIONSHIP",
        trust: "REVIEW_REQUIRED",
        reasons: ["RELATIONSHIP_SEMANTICS_UNVERIFIED"],
        relationshipId: "relationship:iep-contains-service",
        fromEntityId: "entity:iep",
        toEntityId: "entity:service",
        fromInstanceId: "iep-1",
        toInstanceId: "service-1",
        sourceRefs: [{ documentId: "doc-link", page: "1" }],
        evidence: [],
      }],
    };
    const promoted = facts("COMPLETE", [
      dateFact("start", "entity:iep", "iep-1", "meetingDate", "2024-01-01", "doc-start", "1"),
      dateFact("end", "entity:service", "service-1", "startDate", "2024-01-11", "doc-end", "2"),
    ], [link("copied", "relationship:iep-contains-service", "iep-1", "service-1", "doc-link", "1")]);
    const refused = ledgerFor(pack, plan, promoted, unresolved);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.issues.some((item) => item.code === "relationship_promoted")).toBe(true);
      expect("value" in refused).toBe(false);
    }

    const duplicated = structuredClone(plan);
    duplicated.tasks = [...duplicated.tasks, duplicated.tasks[0]!];
    const duplicate = ledgerFor(pack, duplicated, verified);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.issues.some((item) => item.code === "duplicate_row")).toBe(true);

    const unbound = facts("COMPLETE", [textFact("bad", "entity:annual-goal", "goal-a", "not-a-field", "text", "doc-a")]);
    const invalid = ledgerFor(pack, plan, unbound);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect("value" in invalid).toBe(false);
  });

  it("keeps a separately verified relationship when an unresolved candidate names the same endpoints", () => {
    const unresolved: UnresolvedCandidates = {
      schema: UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA,
      candidates: [{
        candidateId: "held-link",
        kind: "RELATIONSHIP",
        trust: "REVIEW_REQUIRED",
        reasons: ["RELATIONSHIP_SEMANTICS_UNVERIFIED"],
        relationshipId: "relationship:iep-contains-service",
        fromEntityId: "entity:iep",
        toEntityId: "entity:service",
        fromInstanceId: "iep-1",
        toInstanceId: "service-1",
        sourceRefs: [{ documentId: "doc-candidate", page: "1" }],
        evidence: [],
      }],
    };
    const verified = facts("COMPLETE", [
      dateFact("start", "entity:iep", "iep-1", "meetingDate", "2024-01-01", "doc-start", "1"),
      dateFact("end", "entity:service", "service-1", "startDate", "2024-01-11", "doc-end", "2"),
    ], [link("separate", "relationship:iep-contains-service", "iep-1", "service-1", "doc-verified", "4")]);
    const value = openLedger(pack, plan, verified, unresolved);
    expect(rowsFor(value, "calculation:C3").find((row) => row.disposition === "COMPUTED")).toMatchObject({
      daysBetween: "10",
      relationshipFactIds: ["separate"],
    });
    expect(value.rows.find((row) => row.candidateId === "held-link")).toMatchObject({
      candidateTrust: "REVIEW_REQUIRED",
      disposition: "NOT_EVALUATED",
      relationshipFactIds: [],
    });
  });

  it("is stable when the same evidence arrives in another order", () => {
    const verified = facts("COMPLETE", [
      textFact("b", "entity:annual-goal", "goal-b", "goalText", "Second", "doc-b"),
      textFact("a", "entity:annual-goal", "goal-a", "goalText", "First", "doc-a"),
    ]);
    const reversed = facts("COMPLETE", [...verified.facts].reverse());
    const left = openLedger(pack, plan, verified);
    const right = openLedger(pack, plan, reversed);
    expect(investigationEvidenceDigest(verified, none())).toBe(investigationEvidenceDigest(reversed, none()));
    expect(right.digest).toBe(left.digest);
    expect(right.rows.map((row) => row.rowId)).toEqual(left.rows.map((row) => row.rowId));
  });
});

function exampleSource(): DomainPackSource {
  const item: PackDefinition = {
    id: "entity:item", kind: "entity", label: "Item",
    fields: [
      { id: "label", valueType: "TEXT" },
      { id: "startDate", valueType: "DATE" },
      { id: "endDate", valueType: "DATE" },
    ],
  };
  const other: PackDefinition = {
    id: "entity:other", kind: "entity", label: "Other",
    fields: [{ id: "name", valueType: "TEXT" }, { id: "when", valueType: "DATE" }],
  };
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: "example-review", version: "1.0.0", title: "Example review" },
    ownership: { scope: "PRO", ownerId: "pro-1", authoredBy: "pro-1" },
    applicability: { jurisdiction: "unspecified", verification: "UNVERIFIED" },
    definitions: [
      item,
      other,
      { id: "relationship:item-other", kind: "relationship", label: "Item to other", fromEntityId: "entity:item", toEntityId: "entity:other", evidenceRequired: true },
      { id: "document:record", kind: "document", label: "Record", aliases: ["record"], appliesWhen: { op: "REVIEW_REQUIRED" }, settlesCheckIds: [] },
      { id: "check:review", kind: "check", label: "Review", criterion: { op: "REVIEW_REQUIRED" }, question: "Is the record complete?" },
      { id: "check:present", kind: "check", label: "Present", criterion: { op: "FIELD_PRESENT", entityId: "entity:item", fieldId: "label" } },
      {
        id: "check:cross", kind: "check", label: "Cross",
        criterion: { op: "ALL", conditions: [{ op: "FIELD_PRESENT", entityId: "entity:item", fieldId: "label" }, { op: "FIELD_PRESENT", entityId: "entity:other", fieldId: "name" }] },
      },
      {
        id: "calculation:span", kind: "calculation", label: "Span", operator: "DAYS_BETWEEN", inputFields: ["startDate", "endDate"], state: "EXECUTABLE",
        bindings: [
          { role: "start", entityId: "entity:item", fieldId: "startDate" },
          { role: "end", entityId: "entity:item", fieldId: "endDate" },
        ],
      },
      {
        id: "calculation:between", kind: "calculation", label: "Between", operator: "DAYS_BETWEEN", inputFields: ["startDate", "when"], state: "EXECUTABLE",
        bindings: [
          { role: "start", entityId: "entity:item", fieldId: "startDate" },
          { role: "end", entityId: "entity:other", fieldId: "when" },
        ],
      },
      { id: "calculation:gap", kind: "calculation", label: "Gap", operator: "DIFFERENCE", inputFields: ["left", "right"], state: "DECLARATION_ONLY", legacyInputs: "left minus right" },
      { id: "question:ask", kind: "question", label: "Ask", audience: "all", text: "What happened?", appliesWhen: { op: "REVIEW_REQUIRED" } },
      { id: "term:word", kind: "term", label: "Word", meaning: "A defined word." },
      { id: "workflow:steps", kind: "workflow", label: "Steps", steps: [{ id: "ask", action: "ASK_QUESTION", requiresReview: true }] },
    ],
    changes: [],
    review: { status: "DRAFT" },
  };
}

function exampleArtifacts(pack: CompiledDomainPack): SupplementalArtifacts {
  const reviewMapped = pack.definitions.some((definition) => definition.id === "check:review");
  const mapped = [...(reviewMapped ? ["check:review"] : []), "conflictPattern:sample", "stateOverlay:sample"];
  return {
    ontology: {
      schema: "hive.domain-ontology-spec/1",
      packRef: { packId: pack.identity.packId, version: pack.identity.version },
      entities: [
        {
          id: "entity:item", factClass: "EVENT",
          fields: [{ id: "label", valueType: "TEXT" }, { id: "startDate", valueType: "DATE" }, { id: "endDate", valueType: "DATE" }],
          ruleIds: ["check:review", "check:present", "question:ask", "calculation:span", "calculation:between"],
          documentKinds: ["document:record"],
          identityKeys: ["label"],
        },
        {
          id: "entity:other", factClass: "EVENT",
          fields: [{ id: "name", valueType: "TEXT" }, { id: "when", valueType: "DATE" }],
          ruleIds: [],
          documentKinds: [],
          identityKeys: ["name"],
        },
      ],
      relationships: [{ id: "relationship:item-other", fromEntityId: "entity:item", toEntityId: "entity:other", evidenceForLink: "The records name one another." }],
      documents: [{ id: "document:record", entities: ["entity:item"], checksSupported: [], requirementBasis: "PROFESSIONALLY_RECOMMENDED" }],
      calculations: [
        { id: "calculation:span", join: null },
        { id: "calculation:between", join: { relationshipId: "relationship:item-other" } },
      ],
    },
    authorityRegister: {
      schema: "hive.domain-authority-register/1",
      authorities: [{
        authorityId: "AUTH-EXAMPLE",
        authorityType: "PROFESSIONAL_REFERENCE",
        evidenceStrength: "PROFESSIONAL_STANDARD",
        humanReview: "NOT_REVIEWED",
        verificationStatus: "AUTHOR_PROPOSED",
        interpretation: { establishes: "A practice note.", doesNotEstablish: "Not a conclusion about a person." },
        limitations: ["Unreviewed practice note."],
        relatedDefinitionIds: mapped,
      }],
      definitionAuthorityMap: Object.fromEntries(mapped.map((id) => [id, ["AUTH-EXAMPLE"]])),
      authorityRoles: reviewMapped ? { "check:review": { "AUTH-EXAMPLE": "CLAIM_AUTHOR_PROPOSED" } } : {},
      authorityClassIndex: { legend: { PROFESSIONAL_REFERENCE: "PROFESSIONAL_CRITERIA" } },
      structuralDefinitions: { "term:word": "STRUCTURAL - persona/report/intake definition; makes no domain claim." },
      unusedAuthorityDisposition: {},
    },
    conflictPatterns: { schema: "hive.domain-conflict-pattern-spec/1", dp1Supported: false, patterns: [{ id: "conflictPattern:sample", entities: ["entity:item"], fields: ["label"], relationshipRequirements: ["relationship:item-other"], authorityIds: ["AUTH-EXAMPLE"] }] },
    stateOverlays: { schema: "hive.domain-state-overlay-spec/1", dp1Supported: false, overlays: [{ id: "stateOverlay:sample", authorityIds: ["AUTH-EXAMPLE"], storedThreshold: null }] },
    factClasses: { schema: "hive.domain-fact-class-spec/1", dp1Supported: false, classes: ["EVENT"] },
    workflowCoverage: { schema: "hive.domain-workflow-coverage-spec/1", dp1Supported: false, rows: [{ workflow: "Deferred path", answers: { remainingClassified: "DEFERRED" }, note: "Deferred module." }] },
    unsupportedOperators: { schema: "hive.domain-unsupported-operator-spec/1", dp1Supported: false, operators: [{ id: "EVERY", status: "UNSUPPORTED", dp1Predicate: false }, { id: "EXISTS", status: "UNSUPPORTED", dp1Predicate: false }] },
  };
}

function examplePlan(source: DomainPackSource = exampleSource(), upstream?: CompiledDomainPack) {
  const compiled = compileDomainPack(source, upstream);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
  const artifacts = exampleArtifacts(compiled.value);
  const digests = Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, packDigest(value)])) as InvestigationPlanInput["digests"];
  const plan = compileInvestigationPlan({ pack: compiled.value, artifacts, digests });
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  return { pack: compiled.value, plan: plan.value };
}

describe("ledger on a non-proof edition", () => {
  it("computes a same-instance span, leaves an undeclared cross check unevaluated, and keeps a disabled id", () => {
    const { pack, plan } = examplePlan();
    const verified = facts("COMPLETE", [
      textFact("label", "entity:item", "north", "label", "North", "doc-1"),
      textFact("name", "entity:other", "south", "name", "South", "doc-2"),
      dateFact("start", "entity:item", "north", "startDate", "2024-01-02", "doc-1", "1"),
      dateFact("end", "entity:item", "north", "endDate", "2024-02-01", "doc-1", "2"),
      dateFact("when", "entity:other", "south", "when", "2024-02-01", "doc-2", "2"),
    ], [link("independent", "relationship:item-other", "north", "south", "doc-link")]);
    const direct = evaluateDomainRules(pack, verified);
    if (!direct.ok) throw new Error(JSON.stringify(direct.issues));
    const value = openLedger(pack, plan, verified);
    expect(rowsFor(value, "calculation:span")[0]).toMatchObject({ disposition: "COMPUTED", daysBetween: "30", population: "VERIFIED_INSTANCE" });
    expect(rowsFor(value, "calculation:between").find((row) => row.disposition === "COMPUTED")).toMatchObject({ daysBetween: "30", relationshipFactIds: ["independent"] });
    expect(rowsFor(value, "check:present").find((row) => row.population === "VERIFIED_INSTANCE")).toMatchObject({ disposition: "ESTABLISHED" });
    expect(rowsFor(value, "check:present").find((row) => row.population === "VERIFIED_INSTANCE")?.authorityGate.length).toBeGreaterThan(0);
    const cross = rowsFor(value, "check:cross")[0];
    expect(cross).toMatchObject({ population: "UNRESOLVED_SUBJECT", disposition: "NOT_EVALUATED" });
    expect(cross?.reasonCodes).toEqual(expect.arrayContaining(["UNRESOLVED_SUBJECT", "RELATIONSHIP_UNDECLARED"]));
    expect(direct.results.find((result) => result.ruleId === "check:cross")?.outcome).toBe("ESTABLISHED");
    expect(rowsFor(value, "check:review").every((row) => row.disposition === "NOT_EVALUATED" && row.reasonCodes.includes("REVIEW_REQUIRED"))).toBe(true);
    expect(rowsFor(value, "calculation:gap").every((row) => row.disposition === "NOT_EVALUATED" && row.daysBetween === undefined)).toBe(true);
    expect(value.rows.filter((row) => row.taskKind === "NOTE_UNSUPPORTED").map((row) => row.disposition)).toEqual(["UNSUPPORTED", "UNSUPPORTED"]);
    expect(value.rows.some((row) => row.disposition === "DEFERRED")).toBe(true);
    expect(value.rows.find((row) => row.definitionId === "stateOverlay:sample")?.missingRequirements).toContain("storedThreshold");

    const disabled = examplePlan({
      schema: DOMAIN_PACK_SOURCE_SCHEMA,
      identity: { packId: "firm-example", version: "1.0.0", title: "Firm edition" },
      ownership: { scope: "FIRM", ownerId: "firm-1", authoredBy: "editor-1" },
      applicability: { jurisdiction: "unspecified", verification: "UNVERIFIED" },
      upstream: { packId: pack.identity.packId, version: pack.identity.version, digest: pack.identity.digest },
      definitions: [],
      changes: [{ op: "disable", definitionId: "check:review", reason: "Not used in this practice" }],
      review: { status: "DRAFT" },
    }, pack);
    const disabledLedger = openLedger(disabled.pack, disabled.plan, facts("COMPLETE", []));
    expect(disabledLedger.upstream?.digest).toBe(pack.identity.digest);
    expect(rowsFor(disabledLedger, "check:review")[0]).toMatchObject({ disposition: "DISABLED", disabledReason: "Not used in this practice" });
    expect(rowsFor(disabledLedger, "check:review").some((row) => row.disposition === "ESTABLISHED" || row.disposition === "NOT_EVALUATED")).toBe(false);
  });

  it("does not promote a binder relationship candidate", () => {
    const { pack, plan } = examplePlan();
    const documentId = "doc-1";
    const page = "Name: North. Started 2024-01-02. Other name: South. Ended 2024-02-01. North authorizes the review of South.";
    const extraction = (rows: ExtractionFact[]): DocExtraction => ({
      schema: "hive.doc-extraction/1",
      documentId,
      fileName: "record.txt",
      pageRange: null,
      document: { titleAsPrinted: "Record", documentType: "record", domain: { label: "review", confidence: null }, issuer: null, aboutPeople: [], keyDates: [], summary: "" },
      facts: rows,
      emptyFields: [],
      referencedDocuments: [],
      glossary: [],
      instructionsIgnored: [],
      coverage: { pageCount: 1, pagesRead: [1], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
    });
    const factRow = (id: string, written: string, quote: string): ExtractionFact => ({
      id, modelId: id, category: "record", subject: "record", attribute: "value", value: written, valueAsWritten: written,
      unit: null, per: null, timeframe: { from: null, to: null, asWritten: null }, modality: "stated", attributedTo: null,
      aboutPersonRef: null, tableContext: null, evidence: [{ page: 1, printedPageLabel: null, quote }], confidence: "high",
    });
    const extractions = [extraction([
      factRow("F-label", "North", "Name: North."),
      factRow("F-start", "2024-01-02", "Started 2024-01-02."),
      factRow("F-name", "South", "Other name: South."),
      factRow("F-when", "2024-02-01", "Ended 2024-02-01."),
    ])];
    const taskId = (definitionId: string) => plan.tasks.find((task) => task.definitionId === definitionId)?.taskId ?? "";
    const candidates = [
      { candidateId: "c-label", taskId: taskId("entity:item"), kind: "FIELD", entityId: "entity:item", instanceId: "north", fieldId: "label", documentId, extractionFactId: "F-label", value: { valueType: "TEXT", value: "North" } },
      { candidateId: "c-start", taskId: taskId("entity:item"), kind: "FIELD", entityId: "entity:item", instanceId: "north", fieldId: "startDate", documentId, extractionFactId: "F-start", value: { valueType: "DATE", value: "2024-01-02" } },
      { candidateId: "c-name", taskId: taskId("entity:other"), kind: "FIELD", entityId: "entity:other", instanceId: "south", fieldId: "name", documentId, extractionFactId: "F-name", value: { valueType: "TEXT", value: "South" } },
      { candidateId: "c-when", taskId: taskId("entity:other"), kind: "FIELD", entityId: "entity:other", instanceId: "south", fieldId: "when", documentId, extractionFactId: "F-when", value: { valueType: "DATE", value: "2024-02-01" } },
      { candidateId: "c-link", taskId: taskId("relationship:item-other"), kind: "RELATIONSHIP", relationshipId: "relationship:item-other", fromInstanceId: "north", toInstanceId: "south", evidence: [{ sourceDocumentId: documentId, page: 1, quote: "North authorizes the review of South." }] },
    ];
    const bound = bindInvestigationCandidates({
      plan,
      pack,
      extractions,
      documents: [{ documentId, pages: [{ pageNumber: 1, text: page }] }],
      candidates: { schema: INVESTIGATION_CANDIDATES_SCHEMA, planDigest: plan.digest, packDigest: pack.identity.digest, extractionDigest: authorizedExtractionDigest(extractions), candidates },
    });
    if (!bound.ok) throw new Error(JSON.stringify(bound.issues));
    expect(bound.verified.relationships).toEqual([]);
    const held = openLedger(pack, plan, bound.verified, bound.unresolved);
    expect(held.evidenceDigest).toBe(bound.digest);
    const review = held.rows.find((row) => row.candidateId === "c-link");
    expect(review).toMatchObject({ candidateTrust: "REVIEW_REQUIRED", disposition: "NOT_EVALUATED", relationshipFactIds: [] });
    expect(review?.reasonCodes).toEqual(expect.arrayContaining(["REVIEW_REQUIRED", "RELATIONSHIP_SEMANTICS_UNVERIFIED"]));
    expect(rowsFor(held, "calculation:between").every((row) => row.daysBetween === undefined)).toBe(true);
    const promoted: UnresolvedCandidate = bound.unresolved.candidates.find((candidate) => candidate.candidateId === "c-link")!;
    const refused = ledgerFor(pack, plan, {
      ...bound.verified,
      relationships: [{
        id: "copied-from-candidate",
        status: "VERIFIED",
        relationshipId: promoted.relationshipId ?? "",
        fromInstanceId: promoted.fromInstanceId ?? "",
        toInstanceId: promoted.toInstanceId ?? "",
        sourceRefs: promoted.sourceRefs.map((ref) => ({ ...ref })),
      }],
    }, bound.unresolved);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.issues.some((item) => item.code === "relationship_promoted")).toBe(true);
    const separate = openLedger(pack, plan, {
      ...bound.verified,
      relationships: [link("separate-link", promoted.relationshipId ?? "", promoted.fromInstanceId ?? "", promoted.toInstanceId ?? "", documentId, "2")],
    }, bound.unresolved);
    expect(rowsFor(separate, "calculation:between").find((row) => row.disposition === "COMPUTED")).toMatchObject({
      daysBetween: "30",
      relationshipFactIds: ["separate-link"],
    });
    expect(separate.rows.find((row) => row.candidateId === "c-link")).toMatchObject({
      candidateTrust: "REVIEW_REQUIRED",
      relationshipFactIds: [],
    });
  });
});
