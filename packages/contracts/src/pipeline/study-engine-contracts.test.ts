import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateApplicability, type ApplicabilityExpr, type CaseAttribute } from "./applicability-expression";
import { CANONICAL_STUDY_SCHEMA } from "./canonical-study-contracts";
import { compileDomainPack, packDigest } from "./domain-pack-compiler";
import { DOMAIN_PACK_SOURCE_SCHEMA, type CompiledDomainPack, type DomainPackSource, type PackApplicability, type PackEdit, type PackOwner } from "./domain-pack-source";
import { domainSourcePattern, engineBenefit, engineFiling, enginePlan, unknownProposalKind } from "./eval/synthetic-domain-fixtures";
import {
  assessInvestigationCompleteness,
  compileEffectiveDomainPack,
  EFFECTIVE_DOMAIN_PACK_SCHEMA,
  INVESTIGATION_COMPLETENESS_SCHEMA,
  parseEffectiveDomainPack,
  parseModelProposal,
  specifyCaseInvestigation,
  verifyModelProposal,
  type EffectiveDomainPack,
  type ExtensionAuthorization,
} from "./study-engine-contracts";

const HIVE_IEP = "11111111-1111-4111-8111-111111111111";
const HIVE_BANKRUPTCY = "22222222-2222-4222-8222-222222222222";
const HIVE_MEDICAID = "55555555-5555-4555-8555-555555555555";
const DOC_IEP = "33333333-3333-4333-8333-333333333333";
const DOC_BANKRUPTCY = "44444444-4444-4444-8444-444444444444";
const DOC_MEDICAID = "66666666-6666-4666-8666-666666666666";

const APPLICABILITY: PackApplicability = { jurisdiction: "US-FEDERAL", verification: "REVIEWED" };

type Fixture = {
  name: string;
  packId: string;
  platformPackId: string;
  proPackId: string;
  proPackId2: string;
  firmPackId: string;
  title: string;
  hiveId: string;
  documentUuid: string;
  entityId: string;
  documentId: string;
  checkId: string;
  spareCheckId: string;
  proCheckId: string;
  proCheckId2: string;
  platformTermId: string;
  termId: string;
  dimension: { key: string; value: string };
  form: string;
  pageText: string;
  quote: string;
};

function compile(source: DomainPackSource, upstream?: CompiledDomainPack): CompiledDomainPack {
  const result = compileDomainPack(source, upstream);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

/** Hash of a compiled snapshot with its digest removed. This is the self-consistent forgery a caller can attach. */
function snapshotDigest(pack: CompiledDomainPack): string {
  const { digest: _digest, ...identity } = pack.identity;
  return packDigest({
    schema: pack.schema,
    compilerVersion: pack.compilerVersion,
    identity,
    ownership: pack.ownership,
    applicability: pack.applicability,
    ...(pack.upstream ? { upstream: pack.upstream } : {}),
    publication: pack.publication,
    review: pack.review,
    definitions: pack.definitions,
    disabledDefinitionIds: pack.disabledDefinitionIds,
    editHistory: pack.editHistory,
  });
}

function textEq(key: string, value: string): ApplicabilityExpr {
  return { op: "EQ", key, value: { type: "TEXT", value } };
}

function textAttr(key: string, value: string, verification: CaseAttribute["verification"] = "REVIEWED"): CaseAttribute {
  return { key, value: { type: "TEXT", value }, verification };
}

function checkDefinition(id: string, label: string): PackEdit {
  return {
    op: "add",
    definitionId: id,
    reason: "Added criterion " + label + ".",
    definition: { id, kind: "check", label, criterion: { op: "REVIEW_REQUIRED" } },
  };
}

function baseSource(fixture: Fixture, applicability: PackApplicability = APPLICABILITY): DomainPackSource {
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: fixture.packId, version: "1.0.0", title: fixture.title },
    ownership: { scope: "PLATFORM", ownerId: "platform", authoredBy: "synthetic" },
    applicability,
    definitions: [
      { id: fixture.entityId, kind: "entity", label: "Subject", fields: [{ id: "name", valueType: "TEXT" }] },
      {
        id: fixture.documentId,
        kind: "document",
        label: "Primary record",
        aliases: ["Record"],
        appliesWhen: { op: "REVIEW_REQUIRED" },
        settlesCheckIds: [fixture.checkId],
      },
      {
        id: fixture.checkId,
        kind: "check",
        label: "Primary record is present",
        criterion: { op: "DOCUMENT_PRESENT", documentKindId: fixture.documentId },
      },
      { id: fixture.spareCheckId, kind: "check", label: "Unused criterion", criterion: { op: "REVIEW_REQUIRED" } },
      { id: fixture.termId, kind: "term", label: "Record", meaning: "A written record." },
    ],
    changes: [],
    review: { status: "REVIEWED", reviewerId: "reviewer", reviewedAt: "2026-11-27" },
  };
}

function editionSource(
  packId: string,
  title: string,
  ownership: PackOwner,
  parent: CompiledDomainPack,
  changes: PackEdit[],
  applicability: PackApplicability = parent.applicability,
): DomainPackSource {
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId, version: "1.0.0", title },
    ownership,
    applicability,
    upstream: { packId: parent.identity.packId, version: parent.identity.version, digest: parent.identity.digest },
    definitions: [],
    changes,
    review: { status: "DRAFT" },
  };
}

function authorizationFor(ownership: PackOwner): ExtensionAuthorization {
  return { actorScope: ownership.scope, actorId: ownership.ownerId };
}

function composeFixture(fixture: Fixture, applicability: PackApplicability = APPLICABILITY) {
  const base = compile(baseSource(fixture, applicability));
  const platformOwnership: PackOwner = { scope: "PLATFORM", ownerId: "platform", authoredBy: "platform" };
  const proOwnership: PackOwner = { scope: "PRO", ownerId: "pro-synthetic", authoredBy: "pro-synthetic" };
  const firmOwnership: PackOwner = { scope: "FIRM", ownerId: "firm-synthetic", authoredBy: "firm-synthetic" };
  const platform = compile(editionSource(fixture.platformPackId, fixture.title + " platform", platformOwnership, base, [{
    op: "add",
    definitionId: fixture.platformTermId,
    reason: "Platform glossary.",
    definition: { id: fixture.platformTermId, kind: "term", label: "Platform label", meaning: "A platform label." },
  }]), base);
  const pro = compile(editionSource(fixture.proPackId, fixture.title + " pro", proOwnership, base, [
    { op: "disable", definitionId: fixture.spareCheckId, reason: "Professional edition does not use this criterion." },
    checkDefinition(fixture.proCheckId, "Professional review"),
  ]), base);
  const pro2 = compile(editionSource(fixture.proPackId2, fixture.title + " pro b", proOwnership, base, [
    checkDefinition(fixture.proCheckId2, "Second professional review"),
  ]), base);
  const firm = compile(editionSource(fixture.firmPackId, fixture.title + " firm", firmOwnership, pro2, [{
    op: "supersede",
    definitionId: fixture.proCheckId2,
    reason: "Firm adopts the second criterion.",
    definition: { id: fixture.proCheckId2, kind: "check", label: "Firm second criterion", criterion: { op: "REVIEW_REQUIRED" } },
  }]), pro2);
  const composed = compileEffectiveDomainPack({
    base,
    when: textEq(fixture.dimension.key, fixture.dimension.value),
    extensions: [
      { pack: platform, authorization: authorizationFor(platformOwnership) },
      { pack: pro, authorization: authorizationFor(proOwnership) },
      { pack: pro2, authorization: authorizationFor(proOwnership) },
      { pack: firm, authorization: authorizationFor(firmOwnership) },
    ],
    attributes: [textAttr(fixture.dimension.key, fixture.dimension.value)],
    clauseExpressions: [{ definitionId: fixture.proCheckId, expression: textEq("form", fixture.form) }],
  });
  return { base, platform, pro, pro2, firm, composed };
}

function hiveAttributes(fixture: Fixture, form = fixture.form, verification: CaseAttribute["verification"] = "REVIEWED") {
  return [
    textAttr(fixture.dimension.key, fixture.dimension.value, verification),
    textAttr("form", form),
  ];
}

function proposal(clauseId: string, fixture: Fixture, quote = fixture.quote, page = 1) {
  return {
    schema: "hive.model-proposal/1",
    proposalId: "proposal:" + clauseId.replaceAll(":", "."),
    clauseId,
    kind: "DOCUMENT",
    citations: [{ documentId: fixture.documentUuid, page, quote }],
    claim: { note: "UNIQUE_CLAIM_TOKEN" },
  };
}

function codes(result: { ok: false; issues: { code: string }[] }): string[] {
  return result.issues.map((item) => item.code);
}

describe("applicability expressions", () => {
  const reviewed = (key: string, value: CaseAttribute["value"]): CaseAttribute => ({ key, value, verification: "REVIEWED" });

  it("uses Kleene truth values and does not treat missing or unverified attributes as true", () => {
    const attributes = new Map<string, CaseAttribute>([
      ["known", reviewed("known", { type: "TEXT", value: "yes" })],
      ["other", reviewed("other", { type: "TEXT", value: "no" })],
      ["draft", { key: "draft", value: { type: "TEXT", value: "yes" }, verification: "UNVERIFIED" }],
    ]);
    const evaluate = (expression: ApplicabilityExpr) => {
      const result = evaluateApplicability(expression, attributes);
      if (!result.ok) throw new Error(result.message);
      return result.result;
    };
    expect(evaluate({ op: "AND", args: [textEq("known", "yes"), { op: "EXISTS", key: "missing" }] })).toBe("FALSE");
    expect(evaluate({ op: "AND", args: [textEq("known", "yes"), textEq("draft", "yes")] })).toBe("UNKNOWN");
    expect(evaluate({ op: "OR", args: [textEq("known", "no"), textEq("missing", "yes")] })).toBe("UNKNOWN");
    expect(evaluate({ op: "OR", args: [textEq("known", "yes"), textEq("draft", "no")] })).toBe("TRUE");
    expect(evaluate({ op: "NOT", arg: textEq("missing", "yes") })).toBe("UNKNOWN");
    expect(evaluate({ op: "NOT", arg: { op: "EXISTS", key: "missing" } })).toBe("TRUE");
    expect(evaluate(textEq("draft", "yes"))).toBe("UNKNOWN");
    expect(evaluate(textEq("other", "yes"))).toBe("FALSE");
    expect(evaluate({ op: "EXISTS", key: "draft" })).toBe("UNKNOWN");
    expect(evaluate({ op: "EXISTS", key: "missing" })).toBe("FALSE");
  });

  it("rejects unsupported predicates and unordered comparisons", () => {
    const issues: { code: string }[] = [];
    const orderedText = evaluateApplicability(
      { op: "GT", key: "name", value: { type: "TEXT", value: "a" } },
      new Map([["name", { key: "name", value: { type: "TEXT", value: "b" }, verification: "REVIEWED" }]]),
    );
    expect(orderedText.ok).toBe(false);
    if (!orderedText.ok) expect(orderedText.code).toBe("unsupported_comparison");
    const parsed = compileEffectiveDomainPack({
      base: compile(baseSource(enginePlan)),
      extensions: [{
        pack: compile(editionSource("synthetic-bad-op", "Bad", { scope: "PRO", ownerId: "pro-synthetic", authoredBy: "pro" }, compile(baseSource(enginePlan)), [
          checkDefinition("check:extra", "Extra"),
        ]), compile(baseSource(enginePlan))),
        when: { op: "MATCHES", key: "framework" } as unknown as ApplicabilityExpr,
        authorization: { actorScope: "PRO", actorId: "pro-synthetic" },
      }],
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) issues.push(...parsed.issues);
    expect(issues.some((item) => item.code === "unsupported_predicate")).toBe(true);
    const ordered = compileEffectiveDomainPack({
      base: compile(baseSource(enginePlan)),
      extensions: [{
        pack: compile(editionSource("synthetic-bad-order", "Bad order", { scope: "PRO", ownerId: "pro-synthetic", authoredBy: "pro" }, compile(baseSource(enginePlan)), [
          checkDefinition("check:extra", "Extra"),
        ]), compile(baseSource(enginePlan))),
        when: { op: "GT", key: "name", value: { type: "TEXT", value: "a" } },
        authorization: { actorScope: "PRO", actorId: "pro-synthetic" },
      }],
    });
    expect(ordered.ok).toBe(false);
    if (!ordered.ok) expect(codes(ordered)).toContain("unsupported_comparison");
  });
});

describe("effective domain pack compiler", () => {
  it("does not import the multi-window engine or name a domain", () => {
    for (const file of ["study-engine-contracts.ts", "effective-domain-pack.ts", "applicability-expression.ts", "extraction-evidence-trust.ts", "domain-prompt-compiler.ts"]) {
      const source = readFileSync(new URL("./" + file, import.meta.url), "utf8");
      expect(source).not.toMatch(/domain-investigation-agent|selectInvestigationWindows|investigation-study-engine|canonical-study-contracts/);
      expect(source).not.toMatch(domainSourcePattern);
    }
    expect(CANONICAL_STUDY_SCHEMA).toBe("hive.canonical-study/1");
    expect(EFFECTIVE_DOMAIN_PACK_SCHEMA).not.toBe(CANONICAL_STUDY_SCHEMA);
  });

  it.each([enginePlan, engineFiling, engineBenefit])("compiles a $name base with platform, two Pro extensions, and a Firm extension", (fixture) => {
    const { composed } = composeFixture(fixture);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const pack = composed.value;
    expect(pack.schema).toBe(EFFECTIVE_DOMAIN_PACK_SCHEMA);
    expect(pack.publication).toBe("UNPUBLISHED");
    expect(pack.layers.map((layer) => layer.role)).toEqual(["BASE", "PLATFORM", "PRO", "PRO", "FIRM"]);
    expect(pack.layers.map((layer) => layer.ownership.scope)).toEqual(["PLATFORM", "PLATFORM", "PRO", "PRO", "FIRM"]);
    expect(pack.attributes.map((attribute) => attribute.key)).toEqual([fixture.dimension.key]);
    expect(pack.decisions.every((decision) => decision.included && decision.result === "TRUE")).toBe(true);
    expect(pack.decisions[3]?.expression).toEqual(pack.decisions[0]?.expression);
    const baseClause = pack.provenance.find((item) => item.definitionId === fixture.checkId);
    const proClause = pack.provenance.find((item) => item.definitionId === fixture.proCheckId);
    const firmClause = pack.provenance.find((item) => item.definitionId === fixture.proCheckId2);
    expect(baseClause).toMatchObject({ layerRole: "BASE", operation: "base", packId: fixture.packId });
    expect(proClause).toMatchObject({ layerRole: "PRO", operation: "add", packId: fixture.proPackId });
    expect(firmClause).toMatchObject({
      layerRole: "FIRM",
      operation: "supersede",
      packId: fixture.firmPackId,
      prior: [expect.objectContaining({ layerRole: "PRO", operation: "add", packId: fixture.proPackId2 })],
    });
    expect(pack.disabled).toEqual([{ definitionId: fixture.spareCheckId, reason: "Professional edition does not use this criterion." }]);
    expect(pack.definitions.some((definition) => definition.id === fixture.spareCheckId)).toBe(false);
    expect(pack.definitions.find((definition) => definition.id === fixture.proCheckId2)?.label).toBe("Firm second criterion");
    expect(Object.isFrozen(pack)).toBe(true);

    const roundTrip = parseEffectiveDomainPack(JSON.parse(JSON.stringify(pack)) as EffectiveDomainPack);
    expect(roundTrip.ok).toBe(true);
    if (!roundTrip.ok) return;
    expect(roundTrip.value.digest).toBe(pack.digest);
    const again = composeFixture(fixture);
    expect(again.composed.ok).toBe(true);
    if (!again.composed.ok) return;
    expect(again.composed.value.digest).toBe(pack.digest);

    const specification = specifyCaseInvestigation({ pack, hiveId: fixture.hiveId, attributes: hiveAttributes(fixture) });
    expect(specification.ok).toBe(true);
    if (!specification.ok) return;
    expect(specification.value.clauses.find((clause) => clause.definitionId === fixture.checkId)?.applicability).toBe("APPLICABLE");
    expect(specification.value.clauses.find((clause) => clause.definitionId === fixture.proCheckId)?.applicability).toBe("APPLICABLE");
    expect(specification.value.clauses.find((clause) => clause.definitionId === fixture.proCheckId2)?.applicability).toBe("APPLICABLE");
    expect(specification.value.clauses.find((clause) => clause.definitionId === fixture.entityId)?.applicability).toBe("STRUCTURAL");
    expect(specification.value.clauses.find((clause) => clause.definitionId === fixture.termId)?.applicability).toBe("PRESENTATION");
    expect(specification.value.clauses.find((clause) => clause.definitionId === fixture.platformTermId)?.applicability).toBe("PRESENTATION");
    expect(specification.value.clauses.find((clause) => clause.definitionId === fixture.spareCheckId)).toMatchObject({
      applicability: "DISABLED",
      editReason: "Professional edition does not use this criterion.",
      provenance: null,
    });

    const pages = new Map([[fixture.documentUuid, [{ pageNumber: 1, text: fixture.pageText }]]]);
    const records = [fixture.documentId, fixture.checkId, fixture.proCheckId, fixture.proCheckId2].map((clauseId) => {
      const verified = verifyModelProposal(proposal(clauseId, fixture), pages);
      expect(verified.ok).toBe(true);
      if (!verified.ok) throw new Error(JSON.stringify(verified.issues));
      const body = JSON.stringify(verified.value);
      expect(body).not.toContain(fixture.quote);
      expect(body).not.toContain("UNIQUE_CLAIM_TOKEN");
      expect(body).not.toContain(fixture.pageText.split(" ").slice(-1)[0] ?? "");
      expect(verified.value.claimStatus).toBe("NOT_ACCEPTED");
      expect(verified.value.outcome).toBe("QUOTE_MATCHED");
      return verified.value;
    });
    const completeness = assessInvestigationCompleteness(specification.value, records);
    expect(completeness.ok).toBe(true);
    if (!completeness.ok) return;
    expect(completeness.value.outcome).toBe("COMPLETE");
    expect(completeness.value.schema).toBe(INVESTIGATION_COMPLETENESS_SCHEMA);
    expect(completeness.value.schema).not.toBe(CANONICAL_STUDY_SCHEMA);
    expect(completeness.value.claimStatus).toBe("NOT_ACCEPTED");
    expect(completeness.value).not.toHaveProperty("publication");
    expect(JSON.stringify(completeness.value)).not.toContain(fixture.quote);
  });

  it("gives three domains different digests from the same compiler", () => {
    const digests = [enginePlan, engineFiling, engineBenefit].map((fixture) => {
      const composed = composeFixture(fixture);
      if (!composed.composed.ok) throw new Error(JSON.stringify(composed.composed.issues));
      return composed.composed.value.digest;
    });
    expect(new Set(digests).size).toBe(3);
  });

  it("keeps clauses out of scope when a reviewed attribute differs", () => {
    const { composed } = composeFixture(engineFiling);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const specification = specifyCaseInvestigation({
      pack: composed.value,
      hiveId: HIVE_BANKRUPTCY,
      attributes: [textAttr("chapter", "13"), textAttr("form", engineFiling.form)],
    });
    expect(specification.ok).toBe(true);
    if (!specification.ok) return;
    const active = specification.value.clauses.filter((clause) => clause.applicability !== "DISABLED");
    expect(active.every((clause) => clause.applicability === "OUT_OF_SCOPE" && clause.reason === "EXPRESSION_FALSE")).toBe(true);
    expect(specification.value.clauses.find((clause) => clause.definitionId === engineFiling.spareCheckId)?.applicability).toBe("DISABLED");
    const completeness = assessInvestigationCompleteness(specification.value, []);
    expect(completeness.ok).toBe(true);
    if (!completeness.ok) return;
    expect(completeness.value.outcome).toBe("NOT_APPLICABLE");
    expect(completeness.value.claimStatus).toBe("NOT_ACCEPTED");
  });

  it("drops only the clause whose own expression does not match", () => {
    const { composed } = composeFixture(enginePlan);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const specification = specifyCaseInvestigation({
      pack: composed.value,
      hiveId: HIVE_IEP,
      attributes: hiveAttributes(enginePlan, "other"),
    });
    expect(specification.ok).toBe(true);
    if (!specification.ok) return;
    expect(specification.value.clauses.find((clause) => clause.definitionId === enginePlan.proCheckId)).toMatchObject({
      applicability: "OUT_OF_SCOPE",
      reason: "EXPRESSION_FALSE",
    });
    expect(specification.value.clauses.find((clause) => clause.definitionId === enginePlan.checkId)?.applicability).toBe("APPLICABLE");
  });

  it("blocks completeness while a matched attribute is unverified", () => {
    const { composed } = composeFixture(enginePlan);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const specification = specifyCaseInvestigation({
      pack: composed.value,
      hiveId: HIVE_IEP,
      attributes: hiveAttributes(enginePlan, enginePlan.form, "UNVERIFIED"),
    });
    expect(specification.ok).toBe(true);
    if (!specification.ok) return;
    expect(specification.value.clauses.find((clause) => clause.definitionId === enginePlan.checkId)?.applicability).toBe("UNVERIFIED");
    const verified = verifyModelProposal(proposal(enginePlan.checkId, enginePlan), new Map([[DOC_IEP, [{ pageNumber: 1, text: enginePlan.pageText }]]]));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const completeness = assessInvestigationCompleteness(specification.value, [verified.value]);
    expect(completeness.ok).toBe(true);
    if (!completeness.ok) return;
    expect(completeness.value.outcome).toBe("BLOCKED");
    expect(completeness.value.claimStatus).toBe("NOT_ACCEPTED");
  });

  it("rejects a quote that is not on the cited page and does not store the quote", () => {
    const verified = verifyModelProposal(proposal(enginePlan.checkId, enginePlan), new Map([[DOC_IEP, [
      { pageNumber: 1, text: "No meeting is recorded here." },
      { pageNumber: 2, text: enginePlan.pageText },
    ]]]));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.outcome).toBe("QUOTE_REJECTED");
    expect(verified.value.citations[0]?.reason).toBe("quote_on_other_page");
    expect(JSON.stringify(verified.value)).not.toContain(enginePlan.quote);
    expect(verified.value.claimStatus).toBe("NOT_ACCEPTED");
  });

  it("rejects model confidence and an unknown proposal kind", () => {
    const withConfidence = parseModelProposal({ ...proposal(enginePlan.checkId, enginePlan), confidence: 0.99 });
    expect(withConfidence.ok).toBe(false);
    if (withConfidence.ok) return;
    expect(withConfidence.issues.some((item) => item.code === "unknown_field")).toBe(true);
    const claimed = parseModelProposal({ ...proposal(enginePlan.checkId, enginePlan), claim: { confidence: 0.99 } });
    expect(claimed.ok).toBe(false);
    if (claimed.ok) return;
    expect(claimed.issues.some((item) => item.code === "confidence_not_evidence")).toBe(true);
    const kind = parseModelProposal({ ...proposal(enginePlan.checkId, enginePlan), kind: unknownProposalKind });
    expect(kind.ok).toBe(false);
  });

  it("records a gap with no citation as absent and does not accept the claim", () => {
    const verified = verifyModelProposal({
      schema: "hive.model-proposal/1",
      proposalId: "proposal:gap",
      clauseId: enginePlan.checkId,
      kind: "GAP",
      citations: [],
      claim: { note: "missing record" },
    }, new Map());
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.outcome).toBe("CITATION_ABSENT");
    expect(verified.value.claimStatus).toBe("NOT_ACCEPTED");
    expect(verified.value.citations).toEqual([]);
  });

  it("fails closed on an unauthorized firm, a broken digest, and reversed precedence", () => {
    const base = compile(baseSource(enginePlan));
    const firmOwnership: PackOwner = { scope: "FIRM", ownerId: "firm-synthetic", authoredBy: "editor" };
    const firm = compile(editionSource("synthetic-firm", "Firm edition", firmOwnership, base, [
      checkDefinition("check:firm-only", "Firm question"),
    ]), base);
    const unauthorized = compileEffectiveDomainPack({
      base,
      extensions: [{ pack: firm, authorization: { actorScope: "PRO", actorId: "pro-synthetic" } }],
    });
    expect(unauthorized.ok).toBe(false);
    if (!unauthorized.ok) expect(codes(unauthorized)).toContain("unauthorized_extension");

    const granted = compileEffectiveDomainPack({
      base,
      extensions: [{
        pack: firm,
        authorization: { actorScope: "PLATFORM", actorId: "platform", grant: "FIRM", reason: "This firm may apply the edition." },
      }],
    });
    expect(granted.ok).toBe(true);
    if (granted.ok) expect(granted.value.layers.map((layer) => layer.role)).toEqual(["BASE", "FIRM"]);

    const brokenPack = structuredClone(firm);
    brokenPack.upstream = { packId: base.identity.packId, version: base.identity.version, digest: "a".repeat(64) };
    const broken = compileEffectiveDomainPack({
      base,
      extensions: [{ pack: brokenPack, authorization: authorizationFor(firmOwnership) }],
    });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(codes(broken)).toContain("upstream_digest_mismatch");

    const pro = compile(editionSource(enginePlan.proPackId, "Pro", { scope: "PRO", ownerId: "pro-synthetic", authoredBy: "pro" }, base, [
      checkDefinition("check:pro-only", "Pro question"),
    ]), base);
    const reversed = compileEffectiveDomainPack({
      base,
      extensions: [
        { pack: firm, authorization: authorizationFor(firmOwnership) },
        { pack: pro, authorization: { actorScope: "PRO", actorId: "pro-synthetic" } },
      ],
    });
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) expect(codes(reversed)).toContain("precedence_order");
  });

  it("recompiles each edition and rejects a digest that does not match its source", () => {
    const base = compile(baseSource(enginePlan));
    const platformOwnership: PackOwner = { scope: "PLATFORM", ownerId: "platform", authoredBy: "platform" };
    const proOwnership: PackOwner = { scope: "PRO", ownerId: "pro-synthetic", authoredBy: "pro" };
    const firmOwnership: PackOwner = { scope: "FIRM", ownerId: "firm-synthetic", authoredBy: "firm" };
    const platform = compile(editionSource(enginePlan.platformPackId, "Platform", platformOwnership, base, [{
      op: "add",
      definitionId: enginePlan.platformTermId,
      reason: "Platform glossary.",
      definition: { id: enginePlan.platformTermId, kind: "term", label: "Platform label", meaning: "A platform label." },
    }]), base);
    const pro = compile(editionSource(enginePlan.proPackId, "Pro", proOwnership, base, [
      checkDefinition(enginePlan.proCheckId, "Professional review"),
    ]), base);
    const firm = compile(editionSource(enginePlan.firmPackId, "Firm", firmOwnership, pro, [
      checkDefinition("check:firm-layer", "Firm layer"),
    ]), pro);

    expect(snapshotDigest(base)).toBe(base.identity.digest);
    expect(snapshotDigest(platform)).toBe(platform.identity.digest);
    expect(snapshotDigest(pro)).toBe(pro.identity.digest);
    expect(snapshotDigest(firm)).toBe(firm.identity.digest);

    const valid = compileEffectiveDomainPack({
      base,
      extensions: [
        { pack: platform, authorization: authorizationFor(platformOwnership) },
        { pack: pro, authorization: authorizationFor(proOwnership) },
        { pack: firm, authorization: authorizationFor(firmOwnership) },
      ],
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.value.publication).toBe("UNPUBLISHED");
    expect(valid.value.layers.map((layer) => layer.digest)).toEqual([
      base.identity.digest,
      platform.identity.digest,
      pro.identity.digest,
      firm.identity.digest,
    ]);
    expect(valid.value.layers.map((layer) => layer.role)).toEqual(["BASE", "PLATFORM", "PRO", "FIRM"]);
    expect(valid.value.definitions.some((definition) => definition.id === "check:firm-layer")).toBe(true);

    const tamperedFirm = structuredClone(firm);
    const inherited = tamperedFirm.definitions.find((definition) => definition.origin.packId === base.identity.packId);
    expect(inherited).toBeTruthy();
    if (!inherited) return;
    inherited.label = "Tampered subject";
    tamperedFirm.identity.digest = snapshotDigest(tamperedFirm);
    expect(tamperedFirm.identity.digest).not.toBe(firm.identity.digest);
    const alteredDefinitions = compileEffectiveDomainPack({
      base,
      extensions: [
        { pack: platform, authorization: authorizationFor(platformOwnership) },
        { pack: pro, authorization: authorizationFor(proOwnership) },
        { pack: tamperedFirm, authorization: authorizationFor(firmOwnership) },
      ],
    });
    expect(alteredDefinitions.ok).toBe(false);
    if (!alteredDefinitions.ok) expect(codes(alteredDefinitions)).toContain("pack_digest_mismatch");

    const tamperedMeta = structuredClone(pro);
    tamperedMeta.ownership = { ...tamperedMeta.ownership, authoredBy: "intruder" };
    tamperedMeta.applicability = { ...tamperedMeta.applicability, jurisdiction: "US-OTHER" };
    const alteredMetadata = compileEffectiveDomainPack({
      base,
      extensions: [{ pack: tamperedMeta, authorization: authorizationFor(proOwnership) }],
    });
    expect(alteredMetadata.ok).toBe(false);
    if (!alteredMetadata.ok) expect(codes(alteredMetadata)).toContain("pack_digest_mismatch");

    const tamperedHistory = structuredClone(pro);
    const lastEdit = tamperedHistory.editHistory[tamperedHistory.editHistory.length - 1];
    expect(lastEdit).toBeTruthy();
    if (!lastEdit) return;
    lastEdit.reason = "Tampered reason.";
    tamperedHistory.identity.digest = snapshotDigest(tamperedHistory);
    expect(snapshotDigest(tamperedHistory)).toBe(tamperedHistory.identity.digest);
    const alteredHistory = compileEffectiveDomainPack({
      base,
      extensions: [{ pack: tamperedHistory, authorization: authorizationFor(proOwnership) }],
    });
    expect(alteredHistory.ok).toBe(false);
    if (!alteredHistory.ok) expect(codes(alteredHistory)).toContain("pack_digest_mismatch");

    const forged = structuredClone(base);
    forged.identity.digest = "f".repeat(64);
    expect(forged.identity.digest).not.toBe(base.identity.digest);
    const forgedResult = compileEffectiveDomainPack({ base: forged });
    expect(forgedResult.ok).toBe(false);
    if (!forgedResult.ok) expect(codes(forgedResult)).toContain("pack_digest_mismatch");

    const tamperedBase = structuredClone(base);
    const baseDefinition = tamperedBase.definitions[0];
    expect(baseDefinition).toBeTruthy();
    if (!baseDefinition) return;
    baseDefinition.label = "Tampered subject";
    const alteredBase = compileEffectiveDomainPack({ base: tamperedBase });
    expect(alteredBase.ok).toBe(false);
    if (!alteredBase.ok) expect(codes(alteredBase)).toContain("pack_digest_mismatch");
  });

  it("does not satisfy an extension from a missing or unverified attribute", () => {
    const base = compile(baseSource(engineBenefit));
    const ownership: PackOwner = { scope: "PRO", ownerId: "pro-synthetic", authoredBy: "pro" };
    const extension = compile(editionSource(engineBenefit.riderPackId, "Rider", ownership, base, [
      checkDefinition("check:rider", "Rider"),
    ]), base);
    const missing = compileEffectiveDomainPack({
      base,
      extensions: [{ pack: extension, when: textEq("program", engineBenefit.programToken), authorization: authorizationFor(ownership) }],
      attributes: [],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(codes(missing)).toContain("applicability_unknown");

    const unverified = compileEffectiveDomainPack({
      base,
      extensions: [{ pack: extension, when: textEq("program", engineBenefit.programToken), authorization: authorizationFor(ownership) }],
      attributes: [textAttr("program", engineBenefit.programToken, "UNVERIFIED")],
    });
    expect(unverified.ok).toBe(false);
    if (!unverified.ok) expect(codes(unverified)).toContain("applicability_unknown");

    const negated = compileEffectiveDomainPack({
      base,
      extensions: [{
        pack: extension,
        when: { op: "NOT", arg: textEq("program", engineBenefit.programToken) },
        authorization: authorizationFor(ownership),
      }],
      attributes: [],
    });
    expect(negated.ok).toBe(false);
    if (!negated.ok) expect(codes(negated)).toContain("applicability_unknown");

    const absent = compileEffectiveDomainPack({
      base,
      extensions: [{
        pack: extension,
        when: { op: "EXISTS", key: "rider" },
        authorization: authorizationFor(ownership),
      }],
      attributes: [],
    });
    expect(absent.ok).toBe(true);
    if (!absent.ok) return;
    expect(absent.value.layers.map((layer) => layer.role)).toEqual(["BASE"]);
    expect(absent.value.decisions[1]).toMatchObject({ result: "FALSE", included: false, packId: engineBenefit.riderPackId });
    expect(absent.value.definitions.some((definition) => definition.id === "check:rider")).toBe(false);
  });

  it("rejects conflicting edits, dangling references, and unauthorized overrides", () => {
    const base = compile(baseSource(enginePlan));
    const proOwnership: PackOwner = { scope: "PRO", ownerId: "pro-synthetic", authoredBy: "pro" };
    const left = compile(editionSource("synthetic-left", "Left", proOwnership, base, [checkDefinition("check:shared", "Shared")]), base);
    const right = compile(editionSource("synthetic-right", "Right", proOwnership, base, [checkDefinition("check:shared", "Shared again")]), base);
    const conflict = compileEffectiveDomainPack({
      base,
      extensions: [
        { pack: left, authorization: authorizationFor(proOwnership) },
        { pack: right, authorization: authorizationFor(proOwnership) },
      ],
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(codes(conflict)).toContain("conflicting_edits");

    const added = compile(editionSource("synthetic-needs-record", "Needs record", proOwnership, base, [{
      op: "add",
      definitionId: "check:needs-record",
      reason: "Needs the primary record.",
      definition: {
        id: "check:needs-record",
        kind: "check",
        label: "Primary record is present",
        criterion: { op: "DOCUMENT_PRESENT", documentKindId: enginePlan.documentId },
      },
    }]), base);
    const removed = compile(editionSource("synthetic-removes-record", "Removes record", proOwnership, base, [
      { op: "disable", definitionId: enginePlan.documentId, reason: "Practice omits this record." },
      { op: "disable", definitionId: enginePlan.checkId, reason: "The criterion depended on that record." },
    ]), base);
    const dangling = compileEffectiveDomainPack({
      base,
      extensions: [
        { pack: added, authorization: authorizationFor(proOwnership) },
        { pack: removed, authorization: authorizationFor(proOwnership) },
      ],
    });
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(codes(dangling)).toContain("invalid_dependency");

    const regulated = compile({
      ...baseSource(enginePlan),
      definitions: [...baseSource(enginePlan).definitions, {
        id: "check:core-rule",
        kind: "check",
        label: "Core requirement",
        criterion: { op: "REVIEW_REQUIRED" },
        authority: { kind: "REGULATION", citation: "Synthetic core rule", reviewedBy: "reviewer", reviewedAt: "2026-11-27" },
      }],
    });
    const firmOwnership: PackOwner = { scope: "FIRM", ownerId: "firm-synthetic", authoredBy: "firm" };
    const firm = compile(editionSource("synthetic-firm-core", "Firm core", firmOwnership, regulated, [
      { op: "disable", definitionId: "check:core-rule", reason: "Firm wants this removed." },
    ]), regulated);
    const override = compileEffectiveDomainPack({
      base: regulated,
      extensions: [{ pack: firm, authorization: authorizationFor(firmOwnership) }],
    });
    expect(override.ok).toBe(false);
    if (!override.ok) expect(codes(override)).toContain("unauthorized_override");

    const related = compile({
      ...baseSource(enginePlan),
      definitions: [
        ...baseSource(enginePlan).definitions,
        { id: "entity:school", kind: "entity", label: "School", fields: [{ id: "name", valueType: "TEXT" }] },
        {
          id: "relationship:attends",
          kind: "relationship",
          label: "Attends",
          fromEntityId: enginePlan.entityId,
          toEntityId: "entity:school",
          evidenceRequired: true,
        },
      ],
    });
    const weakened = compile(editionSource("synthetic-pro-weaken", "Weaken", proOwnership, related, [{
      op: "replace",
      definitionId: "relationship:attends",
      reason: "Skip the evidence requirement.",
      definition: {
        id: "relationship:attends",
        kind: "relationship",
        label: "Attends",
        fromEntityId: enginePlan.entityId,
        toEntityId: "entity:school",
        evidenceRequired: false,
      },
    }]), related);
    const weakenedResult = compileEffectiveDomainPack({
      base: related,
      extensions: [{ pack: weakened, authorization: authorizationFor(proOwnership) }],
    });
    expect(weakenedResult.ok).toBe(false);
    if (!weakenedResult.ok) expect(codes(weakenedResult)).toContain("unauthorized_override");

    const published = structuredClone(base);
    (published as { publication: string }).publication = "PUBLISHED";
    const publication = compileEffectiveDomainPack({ base: published });
    expect(publication.ok).toBe(false);
    if (!publication.ok) expect(codes(publication)).toContain("pack_publication");
  });

  it("inherits applicability, allows a narrower window, and requires authorization to broaden", () => {
    const applicability: PackApplicability = {
      jurisdiction: "US-FEDERAL",
      verification: "REVIEWED",
      effectiveFrom: "2020-01-01",
      effectiveTo: "2030-01-01",
    };
    const base = compile(baseSource(enginePlan, applicability));
    const proOwnership: PackOwner = { scope: "PRO", ownerId: "pro-synthetic", authoredBy: "pro" };
    const narrowed = compile(editionSource(
      "synthetic-narrow",
      "Narrow",
      proOwnership,
      base,
      [checkDefinition("check:narrow", "Narrow")],
      { ...applicability, effectiveTo: "2028-01-01" },
    ), base);
    const inherited = compileEffectiveDomainPack({
      base,
      when: textEq("framework", "idea"),
      extensions: [{ pack: narrowed, authorization: authorizationFor(proOwnership) }],
      attributes: [textAttr("framework", "idea")],
    });
    expect(inherited.ok).toBe(true);
    if (!inherited.ok) return;
    expect(inherited.value.applicability.effectiveTo).toBe("2028-01-01");
    expect(inherited.value.decisions[1]?.expression).toEqual(inherited.value.decisions[0]?.expression);
    expect(inherited.value.definitions.some((definition) => definition.id === "check:narrow")).toBe(true);

    const widened = compile(editionSource(
      "synthetic-wide",
      "Wide",
      proOwnership,
      base,
      [checkDefinition("check:wide", "Wide")],
      { jurisdiction: "US-EAST", verification: "REVIEWED" },
    ), base);
    const refused = compileEffectiveDomainPack({
      base,
      extensions: [{ pack: widened, authorization: authorizationFor(proOwnership) }],
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(codes(refused)).toContain("applicability_broadened");

    const broadenAttempt = compileEffectiveDomainPack({
      base,
      extensions: [{
        pack: widened,
        broaden: { expression: { op: "AND", args: [] }, reason: "Pro cannot broaden." },
        authorization: authorizationFor(proOwnership),
      }],
    });
    expect(broadenAttempt.ok).toBe(false);
    if (!broadenAttempt.ok) expect(codes(broadenAttempt)).toContain("unauthorized_broaden");

    const platformOwnership: PackOwner = { scope: "PLATFORM", ownerId: "platform", authoredBy: "platform" };
    const platform = compile(editionSource(
      "synthetic-platform-wide",
      "Platform wide",
      platformOwnership,
      base,
      [checkDefinition("check:wide-platform", "Platform wide")],
      { jurisdiction: "US-EAST", verification: "REVIEWED" },
    ), base);
    const allowed = compileEffectiveDomainPack({
      base,
      extensions: [{
        pack: platform,
        broaden: { expression: { op: "AND", args: [] }, reason: "Platform authorizes the wider label." },
        authorization: authorizationFor(platformOwnership),
      }],
      attributes: [textAttr("framework", "idea")],
      when: textEq("framework", "idea"),
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) return;
    expect(allowed.value.applicability.jurisdiction).toBe("US-EAST");
    expect(allowed.value.layers.map((layer) => layer.role)).toEqual(["BASE", "PLATFORM"]);
  });

  it("keeps the same digest when unordered inputs are reordered", () => {
    const base = compile(baseSource(enginePlan));
    const ownership: PackOwner = { scope: "PRO", ownerId: "pro-synthetic", authoredBy: "pro" };
    const extension = compile(editionSource("synthetic-dimensions", "Dimensions", ownership, base, [
      checkDefinition("check:dimensions", "Dimensions"),
    ]), base);
    const expression: ApplicabilityExpr = {
      op: "AND",
      args: [
        textEq("program", engineBenefit.programToken),
        { op: "IN", key: "venue", values: [{ type: "TEXT", value: "north" }, { type: "TEXT", value: "south" }] },
        { op: "GT", key: "count", value: { type: "NUMBER", value: "2" } },
        { op: "LTE", key: "opened", value: { type: "DATE", value: "2026-11-27" } },
        { op: "EXISTS", key: "rider" },
        { op: "EQ", key: "active", value: { type: "BOOLEAN", value: true } },
      ],
    };
    const attributes: CaseAttribute[] = [
      textAttr("program", engineBenefit.programToken),
      textAttr("venue", "south"),
      { key: "count", value: { type: "NUMBER", value: "3" }, verification: "REVIEWED" },
      { key: "opened", value: { type: "DATE", value: "2026-01-01" }, verification: "REVIEWED" },
      { key: "rider", value: { type: "BOOLEAN", value: true }, verification: "REVIEWED" },
      { key: "active", value: { type: "BOOLEAN", value: true }, verification: "REVIEWED" },
    ];
    const first = compileEffectiveDomainPack({
      base,
      extensions: [{ pack: extension, when: expression, authorization: authorizationFor(ownership) }],
      attributes,
    });
    const second = compileEffectiveDomainPack({
      base,
      extensions: [{
        pack: extension,
        when: {
          op: "AND",
          args: [...expression.op === "AND" ? [...expression.args].reverse() : []].map((arg) => {
            if (arg.op !== "IN") return arg.op === "GT" ? { ...arg, value: { type: "NUMBER", value: "2.0" } } : arg;
            return { ...arg, values: [...arg.values].reverse() };
          }),
        },
        authorization: authorizationFor(ownership),
      }],
      attributes: [...attributes].reverse(),
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.digest).toBe(first.value.digest);
    expect(first.value.decisions[1]?.included).toBe(true);

    const tooSmall = compileEffectiveDomainPack({
      base,
      extensions: [{ pack: extension, when: expression, authorization: authorizationFor(ownership) }],
      attributes: attributes.map((attribute) => attribute.key === "count"
        ? { ...attribute, value: { type: "NUMBER" as const, value: "2" } }
        : attribute),
    });
    expect(tooSmall.ok).toBe(true);
    if (!tooSmall.ok) return;
    expect(tooSmall.value.decisions[1]).toMatchObject({ result: "FALSE", included: false });
    expect(tooSmall.value.digest).not.toBe(first.value.digest);

    const unknown = compileEffectiveDomainPack({
      base,
      extensions: [{ pack: extension, when: expression, authorization: authorizationFor(ownership) }],
      attributes: attributes.filter((attribute) => attribute.key !== "count"),
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(codes(unknown)).toContain("applicability_unknown");
  });

  it("leaves completeness incomplete when a citation is rejected", () => {
    const { composed } = composeFixture(enginePlan);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const specification = specifyCaseInvestigation({ pack: composed.value, hiveId: HIVE_IEP, attributes: hiveAttributes(enginePlan) });
    expect(specification.ok).toBe(true);
    if (!specification.ok) return;
    const pages = new Map([[DOC_IEP, [{ pageNumber: 1, text: enginePlan.pageText }]]]);
    const matched = [enginePlan.documentId, enginePlan.proCheckId, enginePlan.proCheckId2].map((clauseId) => {
      const result = verifyModelProposal(proposal(clauseId, enginePlan), pages);
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      return result.value;
    });
    const rejected = verifyModelProposal(proposal(enginePlan.checkId, enginePlan, "This sentence is not on the page."), pages);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    const completeness = assessInvestigationCompleteness(specification.value, [...matched, rejected.value]);
    expect(completeness.ok).toBe(true);
    if (!completeness.ok) return;
    expect(completeness.value.outcome).toBe("INCOMPLETE");
    expect(completeness.value.clauses.find((clause) => clause.definitionId === enginePlan.checkId)?.reason).toBe("CITATION_REJECTED");
    expect(completeness.value.claimStatus).toBe("NOT_ACCEPTED");
  });

  it("refuses a verification record for a disabled clause", () => {
    const { composed } = composeFixture(enginePlan);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    const specification = specifyCaseInvestigation({ pack: composed.value, hiveId: HIVE_IEP, attributes: hiveAttributes(enginePlan) });
    expect(specification.ok).toBe(true);
    if (!specification.ok) return;
    const record = verifyModelProposal(proposal(enginePlan.spareCheckId, enginePlan), new Map([[DOC_IEP, [{ pageNumber: 1, text: enginePlan.pageText }]]]));
    expect(record.ok).toBe(true);
    if (!record.ok) return;
    const completeness = assessInvestigationCompleteness(specification.value, [record.value]);
    expect(completeness.ok).toBe(false);
    if (completeness.ok) return;
    expect(completeness.issues.some((item) => item.code === "clause_not_evidence")).toBe(true);
  });
});
