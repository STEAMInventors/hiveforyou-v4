import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileDomainPack } from "../domain-pack-compiler";
import { UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA, type UnresolvedCandidates } from "../domain-investigation-binder";
import { compileInvestigationPlan, type InvestigationPlanInput } from "../domain-investigation-plan";
import { buildCoverageLedger, investigationEvidenceDigest, type DomainInvestigationLedger } from "../domain-investigation-ledger";
import { evaluateDomainRules, VERIFIED_CASE_FACTS_SCHEMA, type VerifiedCaseFacts, type VerifiedFact, type VerifiedRelationshipFact } from "../domain-pack-rules";
import type { CompiledDomainPack, DomainPackSource } from "../domain-pack-source";

const ROOT = join(import.meta.dirname, "../../../../../packs/drafts/iep-us-federal/v0.3.0");
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
    const source = readFileSync(join(import.meta.dirname, "../domain-investigation-ledger.ts"), "utf8");
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
