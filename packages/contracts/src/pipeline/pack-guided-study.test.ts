import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeSha256Digest } from "../source-documents/document-read-contracts";
import type { CanonicalStudy } from "./canonical-study-contracts";
import { compileDomainPack } from "./domain-pack-compiler";
import { DOMAIN_PACK_SOURCE_SCHEMA, type CompiledDomainPack, type DomainPackSource, type PackApplicability, type PackDefinition, type PackEdit, type PackOwner } from "./domain-pack-source";
import type { DocExtraction, ExtractionFact } from "./extraction-contracts";
import { packGuidedResolutionDigest, resolvePackGuidedOutput } from "./pack-guided-output";
import { constructPackGuidedStudy, PACK_GUIDED_STUDY_ENGINE_ID } from "./pack-guided-study";
import { PACK_GUIDED_OUTPUT_SCHEMA, compileEffectiveDomainPack, specifyCaseInvestigation, verifyExtractionEvidence, type ApplicabilityExpr, type CaseAttribute, type ExtensionAuthorization } from "./study-engine-contracts";
import { domainSourcePattern, studyBenefit, studyFiling, studyPlan } from "./eval/synthetic-domain-fixtures";

const APPLICABILITY: PackApplicability = { jurisdiction: "US-FEDERAL", verification: "REVIEWED" };
const QUESTION_ID = "question:written-date";
const HIDDEN_ID = "check:hidden";
const MARKER = "Cedar";

type Fixture = {
  name: string;
  packId: string;
  proPackId: string;
  firmPackId: string;
  hiveId: string;
  documentUuid: string;
  entityId: string;
  documentId: string;
  checkId: string;
  proCheckId: string;
  firmCheckId: string;
  dimension: { key: string; value: string };
  form: string;
  date: string;
  label: string;
};

function textEq(key: string, value: string): ApplicabilityExpr {
  return { op: "EQ", key, value: { type: "TEXT", value } };
}

function textAttr(key: string, value: string): CaseAttribute {
  return { key, value: { type: "TEXT", value }, verification: "REVIEWED" };
}

function compile(source: DomainPackSource, upstream?: CompiledDomainPack): CompiledDomainPack {
  const result = compileDomainPack(source, upstream);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function quoteFor(fixture: Fixture): string {
  return `The written date is ${fixture.date} and the label is ${fixture.label} and the marker is ${MARKER}.`;
}

function fact(id: string, value: string, quote: string): ExtractionFact {
  return {
    id,
    modelId: id,
    category: "record",
    subject: "record",
    attribute: "value",
    value,
    valueAsWritten: value,
    unit: null,
    per: null,
    timeframe: { from: null, to: null, asWritten: null },
    modality: "stated",
    attributedTo: null,
    aboutPersonRef: null,
    tableContext: null,
    evidence: [{ page: 1, printedPageLabel: null, quote }],
    confidence: "high",
  };
}

function definitions(fixture: Fixture, extra: PackDefinition[] = []): PackDefinition[] {
  return [
    {
      id: fixture.entityId,
      kind: "entity",
      label: "Subject",
      fields: [
        { id: "name", valueType: "TEXT", required: true },
        { id: "writtenDate", valueType: "DATE", required: true },
        { id: "marker", valueType: "TEXT", required: true },
        { id: "endDate", valueType: "DATE" },
      ],
    },
    {
      id: fixture.documentId,
      kind: "document",
      label: "Primary record",
      aliases: ["Record"],
      appliesWhen: { op: "REVIEW_REQUIRED" },
      settlesCheckIds: [fixture.checkId],
    },
    { id: fixture.checkId, kind: "check", label: "Primary record is present", criterion: { op: "REVIEW_REQUIRED" } },
    { id: HIDDEN_ID, kind: "check", label: "Hidden false criterion", criterion: { op: "REVIEW_REQUIRED" } },
    {
      id: "relationship:link",
      kind: "relationship",
      label: "Subject link",
      fromEntityId: fixture.entityId,
      toEntityId: fixture.entityId,
      evidenceRequired: true,
    },
    {
      id: QUESTION_ID,
      kind: "question",
      label: "Written date",
      audience: "all",
      text: "Which written date is on the primary record?",
      appliesWhen: { op: "REVIEW_REQUIRED" },
    },
    {
      id: "calculation:interval",
      kind: "calculation",
      label: "Interval",
      operator: "DAYS_BETWEEN",
      inputFields: ["writtenDate", "endDate"],
      state: "EXECUTABLE",
      bindings: [
        { role: "start", entityId: fixture.entityId, fieldId: "writtenDate" },
        { role: "end", entityId: fixture.entityId, fieldId: "endDate" },
      ],
    },
    { id: "term:alpha", kind: "term", label: "Alpha glossary", meaning: "A shared glossary entry." },
    {
      id: "workflow:review",
      kind: "workflow",
      label: "Review steps",
      steps: [{ id: "step:review", action: "FLAG_REVIEW", requiresReview: true }],
    },
    ...extra,
  ];
}

function baseSource(fixture: Fixture): DomainPackSource {
  return {
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: fixture.packId, version: "1.0.0", title: fixture.name },
    ownership: { scope: "PLATFORM", ownerId: "platform", authoredBy: "synthetic" },
    applicability: APPLICABILITY,
    definitions: definitions(fixture),
    changes: [],
    review: { status: "REVIEWED", reviewerId: "reviewer", reviewedAt: "2026-11-27" },
  };
}

function world(fixture: Fixture, extensions: boolean) {
  const base = compile(baseSource(fixture));
  const proOwnership: PackOwner = { scope: "PRO", ownerId: "pro-synthetic", authoredBy: "pro-synthetic" };
  const firmOwnership: PackOwner = { scope: "FIRM", ownerId: "firm-synthetic", authoredBy: "firm-synthetic" };
  const pro = compile({
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: fixture.proPackId, version: "1.0.0", title: fixture.name + " pro" },
    ownership: proOwnership,
    applicability: base.applicability,
    upstream: { packId: base.identity.packId, version: base.identity.version, digest: base.identity.digest },
    definitions: [],
    changes: [{
      op: "add",
      definitionId: fixture.proCheckId,
      reason: "Professional criterion.",
      definition: {
        id: fixture.proCheckId,
        kind: "check",
        label: "Shown professional criterion",
        criterion: { op: "FIELD_PRESENT", entityId: fixture.entityId, fieldId: "name" },
      },
    } satisfies PackEdit],
    review: { status: "DRAFT" },
  }, base);
  const firm = compile({
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId: fixture.firmPackId, version: "1.0.0", title: fixture.name + " firm" },
    ownership: firmOwnership,
    applicability: base.applicability,
    upstream: { packId: base.identity.packId, version: base.identity.version, digest: base.identity.digest },
    definitions: [],
    changes: [{
      op: "add",
      definitionId: fixture.firmCheckId,
      reason: "Firm criterion.",
      definition: {
        id: fixture.firmCheckId,
        kind: "check",
        label: "Shown firm criterion",
        criterion: { op: "REVIEW_REQUIRED" },
      },
    } satisfies PackEdit],
    review: { status: "DRAFT" },
  }, base);
  const authorization = (ownership: PackOwner): ExtensionAuthorization => ({ actorScope: ownership.scope, actorId: ownership.ownerId });
  const attributes = [textAttr(fixture.dimension.key, fixture.dimension.value), textAttr("form", fixture.form)];
  const pack = compileEffectiveDomainPack({
    base,
    when: textEq(fixture.dimension.key, fixture.dimension.value),
    extensions: extensions ? [
      { pack: pro, authorization: authorization(proOwnership) },
      { pack: firm, authorization: authorization(firmOwnership) },
    ] : [],
    attributes,
    clauseExpressions: [
      { definitionId: HIDDEN_ID, expression: textEq("form", "never") },
      ...(extensions ? [{ definitionId: fixture.proCheckId, expression: textEq("form", fixture.form) }] : []),
    ],
  });
  if (!pack.ok) throw new Error(JSON.stringify(pack.issues));
  const specification = specifyCaseInvestigation({ pack: pack.value, hiveId: fixture.hiveId, attributes });
  if (!specification.ok) throw new Error(JSON.stringify(specification.issues));
  const quote = quoteFor(fixture);
  const pageText = `${quote} Extra margin.`;
  const extraction: DocExtraction = {
    schema: "hive.doc-extraction/1",
    documentId: fixture.documentUuid,
    fileName: "record.txt",
    pageRange: null,
    document: {
      titleAsPrinted: "Record",
      documentType: "record",
      domain: { label: "record", confidence: "high" },
      issuer: null,
      aboutPeople: [],
      keyDates: [],
      summary: "",
    },
    facts: [
      fact("fact-date", fixture.date, quote),
      fact("fact-name", fixture.label, quote),
      fact("fact-marker", MARKER, quote),
    ],
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: { pageCount: 1, pagesRead: [1], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
  };
  const page = {
    documentId: fixture.documentUuid,
    pageNumber: 1,
    text: pageText,
    sourcePageDigest: computeSha256Digest(pageText),
  };
  const evidence = verifyExtractionEvidence({ extractions: [extraction], pages: [page] });
  if (!evidence.ok) throw new Error(JSON.stringify(evidence.issues));
  const digest = (factId: string) => evidence.value.index.records.find((record) => record.extractionFactId === factId && record.outcome === "QUOTE_MATCHED")?.recordDigest ?? "";
  const output = {
    schema: PACK_GUIDED_OUTPUT_SCHEMA,
    proposals: [
      field(fixture, "proposal:date", "fact-date", "writtenDate", "inst-date", digest("fact-date")),
      field(fixture, "proposal:name", "fact-name", "name", "inst-name", digest("fact-name")),
      field(fixture, "proposal:marker", "fact-marker", "marker", "inst-marker", digest("fact-marker")),
      {
        proposalId: "proposal:document",
        clauseId: fixture.documentId,
        kind: "DOCUMENT",
        evidenceRecordDigests: [digest("fact-date")],
        claim: { documentKindId: fixture.documentId, role: "ANCHOR" },
        uncertainty: null,
      },
      {
        proposalId: "proposal:link",
        clauseId: "relationship:link",
        kind: "RELATIONSHIP",
        evidenceRecordDigests: [digest("fact-name")],
        claim: { relationshipId: "relationship:link", fromInstanceId: "inst-name", toInstanceId: "inst-date" },
        uncertainty: null,
      },
      {
        proposalId: "proposal:question",
        clauseId: QUESTION_ID,
        kind: "STATEMENT",
        evidenceRecordDigests: [digest("fact-date")],
        claim: { questionId: QUESTION_ID },
        uncertainty: null,
      },
      {
        proposalId: "proposal:interpretation",
        clauseId: fixture.entityId,
        kind: "STATEMENT",
        evidenceRecordDigests: [digest("fact-name")],
        claim: { statement: "A later reading is not established." },
        uncertainty: null,
      },
      {
        proposalId: "proposal:gap",
        clauseId: fixture.checkId,
        kind: "GAP",
        evidenceRecordDigests: [],
        claim: { entityId: fixture.entityId, fieldId: "endDate" },
        uncertainty: "A second date is not in the saved evidence.",
      },
    ],
  };
  return {
    fixture,
    pack: pack.value,
    specification: specification.value,
    extraction,
    page,
    evidence: evidence.value,
    output,
    quote,
  };
}

function field(fixture: Fixture, proposalId: string, factId: string, fieldId: string, instanceId: string, digest: string) {
  return {
    proposalId,
    clauseId: fixture.entityId,
    kind: "FIELD",
    evidenceRecordDigests: [digest],
    claim: { entityId: fixture.entityId, instanceId, fieldId },
    uncertainty: null,
  };
}

function built(fixture: Fixture, extensions: boolean) {
  const prepared = world(fixture, extensions);
  const resolved = resolvePackGuidedOutput({
    output: prepared.output,
    specification: prepared.specification,
    questionObligationIds: [QUESTION_ID],
    evidence: prepared.evidence.index,
    pages: [prepared.page],
    extractions: [prepared.extraction],
  });
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
  const prior = { schema: "hive.canonical-study/1", marker: fixture.packId } as unknown as CanonicalStudy;
  const run = (resolution = resolved.value, pack = prepared.pack, specification = prepared.specification) => constructPackGuidedStudy({
    resolution,
    pack,
    specification,
    extractions: [prepared.extraction],
    pages: [{ documentId: prepared.page.documentId, pages: [{ pageNumber: prepared.page.pageNumber, text: prepared.page.text }] }],
    questionObligationIds: [QUESTION_ID],
    evidenceDigest: prepared.evidence.index.digest,
    existingStudy: prior,
    studyDate: "2026-11-27",
  });
  return { ...prepared, resolved: resolved.value, prior, run };
}

describe("pack-guided study construction", () => {
  it("does not name a domain, read pages, or schedule investigation windows", () => {
    const source = readFileSync(new URL("./pack-guided-study.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(domainSourcePattern);
    expect(source).not.toMatch(/read_pages|examinedPages|selectInvestigationWindows|domain-investigation-agent/);
    expect(source).toMatch(/runInvestigationStudyEngine/);
  });

  it.each([studyPlan, studyFiling, studyBenefit])("constructs one study for synthetic $name with the same constructor", (fixture) => {
    const base = built(fixture, false);
    const result = base.run();
    expect(result.ok).toBe(true);
    if (!result.ok || !result.study) return;
    expect(result.study).not.toBe(base.prior);
    expect(result.study.schema).toBe("hive.canonical-study/1");
    expect(result.engineId).toBe(PACK_GUIDED_STUDY_ENGINE_ID);
    expect(result.effectivePackDigest).toBe(base.pack.digest);
    expect(result.evidenceDigest).toBe(base.evidence.index.digest);
    expect(result.validation.outcome).toBe("ACCEPTED");
    expect(result.validation.compiledPackDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.validation.verifiedFactIds).toEqual(["fact-date", "fact-marker", "fact-name"]);
    expect(result.validation.interpretationIds).toEqual(["proposal:interpretation"]);
    expect(result.validation.uncertaintyIds).toEqual(["proposal:gap"]);
    expect(result.validation.unresolvedRelationshipIds).toEqual(["relationship:link"]);
    expect(result.study.documents).toEqual([expect.objectContaining({ sourceDocumentId: fixture.documentUuid, role: "ANCHOR", classification: "QUOTED" })]);
    expect(result.study.spine.filter((item) => item.kind === "calculation")).toEqual([]);
    expect(result.study.spine.some((item) => item.kind === "relationship" && item.status === "SUPPORTED")).toBe(false);
    expect(JSON.stringify(result.study.outsideSpine)).toContain("Calculation Interval was not published");
    expect(JSON.stringify(result.study.outsideSpine)).toContain("is not verified");
    expect(JSON.stringify(result.study.outsideSpine)).toContain("Assessment is not a supported finding");
    expect(JSON.stringify(result.study.outsideSpine)).toContain("Searched and not found");
    expect(JSON.stringify(result.study.spine)).not.toContain("A later reading is not established");
    expect(result.study.checklist?.find((item) => item.checkId === fixture.proCheckId)).toBeUndefined();
    expect(result.study.checklist?.find((item) => item.checkId === HIDDEN_ID)).toBeUndefined();
    const again = base.run();
    expect(again.validation.digest).toBe(result.validation.digest);
    expect(JSON.stringify(again.study)).toBe(JSON.stringify(result.study));
  });

  it("lets a Pro clause change the checklist without a core-code change", () => {
    const base = built(studyPlan, false);
    const pro = built(studyPlan, true);
    const without = base.run();
    const withPro = pro.run();
    expect(without.ok && withPro.ok).toBe(true);
    if (!without.ok || !withPro.ok || !without.study || !withPro.study) return;
    expect(without.study.checklist?.some((item) => item.checkId === studyPlan.proCheckId)).toBe(false);
    expect(withPro.study.checklist).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkId: studyPlan.proCheckId, verdict: "SHOWN" }),
      expect.objectContaining({ checkId: studyPlan.firmCheckId, verdict: "NOT_ASSESSED" }),
    ]));
    expect(withPro.validation.effectivePackDigest).not.toBe(without.validation.effectivePackDigest);
  });

  it("preserves the existing study when evidence, questions, relationships, calculations, or required fields fail", () => {
    const sample = built(studyFiling, true);
    const prior = sample.prior;
    const tampered = structuredClone(sample.resolved);
    const reference = tampered.proposals[0]?.references[0];
    if (!reference) throw new Error("missing reference");
    reference.quote = "This quotation was not on the page.";
    const hallucinated = sample.run(tampered);
    expect(hallucinated).toMatchObject({ ok: false, code: "evidence_unresolved", study: prior });

    const dropped = {
      ...sample.resolved,
      proposals: sample.resolved.proposals.filter((proposal) => proposal.proposalId !== "proposal:question"),
    };
    const missingQuestion = sample.run({ ...dropped, digest: packGuidedResolutionDigest(dropped) });
    expect(missingQuestion).toMatchObject({ ok: false, code: "mandatory_question_missing", study: prior });

    const linked = structuredClone(sample.resolved);
    const link = linked.proposals.find((proposal) => proposal.kind === "RELATIONSHIP");
    if (!link) throw new Error("missing relationship");
    link.claim = { ...link.claim, relationshipId: "relationship:missing" };
    const invalid = sample.run({ ...linked, digest: packGuidedResolutionDigest(linked) });
    expect(invalid).toMatchObject({ ok: false, code: "relationship_invalid", study: prior });

    const calculated = structuredClone(sample.resolved);
    const statement = calculated.proposals.find((proposal) => proposal.proposalId === "proposal:interpretation");
    if (!statement) throw new Error("missing statement");
    statement.claim = { ...statement.claim, result: "30" };
    const unsupported = sample.run({ ...calculated, digest: packGuidedResolutionDigest(calculated) });
    expect(unsupported).toMatchObject({ ok: false, code: "calculation_unsupported", study: prior });

    const partial = {
      ...sample.resolved,
      proposals: sample.resolved.proposals.filter((proposal) => proposal.proposalId !== "proposal:marker"),
    };
    const incomplete = sample.run({ ...partial, digest: packGuidedResolutionDigest(partial) });
    expect(incomplete).toMatchObject({ ok: false, code: "incomplete_evidence", study: prior });
    expect(incomplete.study).toBe(prior);
  });
});
