import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DOMAIN_INVESTIGATION_PROMPT_ID,
  DOMAIN_PACK_SOURCE_SCHEMA,
  FIELD_MAPPING_PROMPT_ID,
  PLANNER_CONTRACT_VERSION,
  plannerCompletionAcceptsPrompt,
  type DocExtraction,
  type ExtractionFact,
} from "@hiveforyou/contracts";
import { computeSha256Digest } from "@hiveforyou/contracts/document-read";
import {
  PACK_GUIDED_CANONICALIZE_PROMPT_ID,
  PACK_GUIDED_OUTPUT_SCHEMA,
  SYNTHETIC_EXECUTION_FIXTURES,
  compileDomainPack,
  compileEffectiveDomainPack,
  specifyCaseInvestigation,
  verifyExtractionEvidence,
  type ApplicabilityExpr,
  type CaseAttribute,
  type SyntheticExecutionFixture,
} from "@hiveforyou/contracts/study-engine";

import { runPackGuidedCanonicalize } from "./pack-guided-canonicalize";
import { canonicalizeCases, domainSourcePattern } from "../../../../../packages/contracts/src/pipeline/eval/synthetic-domain-fixtures";

const CORRELATION_ID = "77777777-7777-4777-8777-777777777777";
const RUN_ID = "88888888-8888-4888-8888-888888888888";
const config = { baseUrl: "https://planner.example.test", serviceToken: "t", timeoutMs: 1000 };
const QUESTION_ID = "question:written-date";

const CASES = canonicalizeCases.map((item) => ({
  name: item.name,
  fixture: SYNTHETIC_EXECUTION_FIXTURES[item.fixtureIndex]!,
  packId: item.packId,
  dimension: item.dimension,
}));

function textEq(key: string, value: string): ApplicabilityExpr {
  return { op: "EQ", key, value: { type: "TEXT", value } };
}

function textAttr(key: string, value: string): CaseAttribute {
  return { key, value: { type: "TEXT", value }, verification: "REVIEWED" };
}

function fact(id: string, quote: string, value: string): ExtractionFact {
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

function extraction(documentId: string, item: ExtractionFact): DocExtraction {
  return {
    schema: "hive.doc-extraction/1",
    documentId,
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
    facts: [item],
    emptyFields: [],
    referencedDocuments: [],
    glossary: [],
    instructionsIgnored: [],
    coverage: { pageCount: 1, pagesRead: [1], pagesBlankOrUnreadable: [], truncated: false, lastPageCompleted: 1 },
  };
}

function prepared(fixture: SyntheticExecutionFixture, packId: string, dimension: { key: string; value: string }) {
  const compiled = compileDomainPack({
    schema: DOMAIN_PACK_SOURCE_SCHEMA,
    identity: { packId, version: "1.0.0", title: "Synthetic record pack" },
    ownership: { scope: "PLATFORM", ownerId: "platform", authoredBy: "synthetic" },
    applicability: { jurisdiction: "US-FEDERAL", verification: "REVIEWED" },
    definitions: [
      { id: "entity:subject", kind: "entity", label: "Subject", fields: [{ id: "name", valueType: "TEXT" }] },
      {
        id: "document:record",
        kind: "document",
        label: "Primary record",
        aliases: ["Record"],
        appliesWhen: { op: "REVIEW_REQUIRED" },
        settlesCheckIds: ["check:present"],
      },
      { id: "check:present", kind: "check", label: "Record is present", criterion: { op: "REVIEW_REQUIRED" } },
      {
        id: "relationship:link",
        kind: "relationship",
        label: "Subject link",
        fromEntityId: "entity:subject",
        toEntityId: "entity:subject",
        evidenceRequired: true,
      },
      {
        id: QUESTION_ID,
        kind: "question",
        label: "Written date",
        audience: "all",
        text: "What date is written?",
        appliesWhen: { op: "REVIEW_REQUIRED" },
      },
      {
        id: "calculation:declared",
        kind: "calculation",
        label: "Declared interval",
        operator: "DAYS_BETWEEN",
        inputFields: [],
        state: "DECLARATION_ONLY",
        legacyInputs: "two dates",
      },
    ],
    changes: [],
    review: { status: "REVIEWED", reviewerId: "reviewer", reviewedAt: "2026-11-27" },
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
  const pack = compileEffectiveDomainPack({
    base: compiled.value,
    when: textEq(dimension.key, dimension.value),
    attributes: [textAttr(dimension.key, dimension.value)],
  });
  if (!pack.ok) throw new Error(JSON.stringify(pack.issues));
  const specification = specifyCaseInvestigation({
    pack: pack.value,
    hiveId: fixture.hiveId,
    attributes: [textAttr(dimension.key, dimension.value)],
  });
  if (!specification.ok) throw new Error(JSON.stringify(specification.issues));
  const written = extraction(fixture.documentId, fact(fixture.factId, fixture.quote, "date-token"));
  const page = {
    documentId: fixture.documentId,
    pageNumber: 1,
    text: fixture.pageText,
    sourcePageDigest: computeSha256Digest(fixture.pageText),
  };
  const evidence = verifyExtractionEvidence({ extractions: [written], pages: [page] });
  if (!evidence.ok) throw new Error(JSON.stringify(evidence.issues));
  return { pack: pack.value, specification: specification.value, evidence: evidence.value, page, written };
}

function success(content: unknown) {
  return new Response(
    JSON.stringify({
      contract_version: PLANNER_CONTRACT_VERSION,
      task: "canonicalize",
      model_alias: "heavy_lifter",
      resolved_model: "model-x",
      content_json: content,
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      latency_ms: 20,
      finish_reason: "stop",
    }),
    { status: 200 },
  );
}

function failure(status: number, errorCode: string, reason: string) {
  return new Response(
    JSON.stringify({ contract_version: "planner-error@1", error_code: errorCode, retryable: false, diagnostic_reason: reason }),
    { status },
  );
}

function answer(digest: string | null, uncertainty: string | null) {
  return {
    schema: PACK_GUIDED_OUTPUT_SCHEMA,
    proposals: [
      ...(digest
        ? [{
            proposalId: "proposal:field",
            clauseId: "entity:subject",
            kind: "FIELD",
            evidenceRecordDigests: [digest],
            claim: { fieldId: "name" },
            uncertainty: null,
          }]
        : []),
      {
        proposalId: "proposal:question",
        clauseId: QUESTION_ID,
        kind: "STATEMENT",
        evidenceRecordDigests: digest ? [digest] : [],
        claim: { questionId: QUESTION_ID },
        uncertainty,
      },
    ],
  };
}

function run(
  fixture: SyntheticExecutionFixture,
  packId: string,
  dimension: { key: string; value: string },
  fetchFn: ReturnType<typeof vi.fn>,
  extra: Record<string, unknown> = {},
) {
  const caseData = prepared(fixture, packId, dimension);
  return {
    caseData,
    result: runPackGuidedCanonicalize({
      planner: { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
      correlationId: CORRELATION_ID,
      runId: RUN_ID,
      fixtureId: fixture.fixtureId,
      pack: caseData.pack,
      specification: caseData.specification,
      evidence: caseData.evidence,
      pages: [caseData.page],
      extractions: [caseData.written],
      intent: "What date is written?",
      ...extra,
    }),
  };
}

describe("pack-guided canonicalize", () => {
  it("uses one completion contract and does not open the investigation scheduler", () => {
    const source = readFileSync(new URL("./pack-guided-canonicalize.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(domainSourcePattern);
    expect(source).not.toMatch(/runDomainMappingInvestigation|study-agent-turn|selectInvestigationWindows/);
    expect(plannerCompletionAcceptsPrompt("canonicalize", PACK_GUIDED_CANONICALIZE_PROMPT_ID)).toBe(true);
    expect(plannerCompletionAcceptsPrompt("canonicalize", "hive-canonicalize/1")).toBe(true);
    expect(plannerCompletionAcceptsPrompt("canonicalize", DOMAIN_INVESTIGATION_PROMPT_ID)).toBe(false);
    expect(plannerCompletionAcceptsPrompt("canonicalize", FIELD_MAPPING_PROMPT_ID)).toBe(false);
  });

  it.each(CASES)("$name accepts a cited completion and recovers the trusted quotation", async ({ fixture, packId, dimension }) => {
    const preview = prepared(fixture, packId, dimension);
    const digest = preview.evidence.index.records[0]?.recordDigest;
    if (!digest) throw new Error("missing digest");
    const fetchFn = vi.fn().mockResolvedValueOnce(success(answer(digest, null)));
    const { result } = run(fixture, packId, dimension, fetchFn);
    const settled = await result;
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = String(fetchFn.mock.calls[0]?.[0]);
    const body = JSON.parse(String((fetchFn.mock.calls[0]?.[1] as RequestInit).body)) as {
      task: string;
      prompt_id: string;
      user_payload: { sections: unknown };
    };
    expect(url).toBe("https://planner.example.test/v1/plan-completion");
    expect(body.task).toBe("canonicalize");
    expect(body.prompt_id).toBe(PACK_GUIDED_CANONICALIZE_PROMPT_ID);
    expect(JSON.stringify(body.user_payload)).not.toContain(fixture.quote);
    if (!settled.ok) throw new Error(settled.error.diagnosticReason);
    expect(settled.engine).toBe(PACK_GUIDED_CANONICALIZE_PROMPT_ID);
    expect(settled.resolution.studyStatus).toBe("NOT_ACCEPTED");
    expect(settled.resolution.claimStatus).toBe("NOT_ACCEPTED");
    expect(settled.resolution).not.toHaveProperty("spine");
    const recovered = settled.resolution.proposals.flatMap((proposal) => proposal.references);
    expect(recovered.map((reference) => reference.quote)).toEqual([fixture.quote, fixture.quote]);
    expect(recovered.every((reference) => reference.value === "date-token")).toBe(true);
    expect(JSON.stringify(answer(digest, null))).not.toContain(fixture.quote);
  });

  it.each(CASES)("$name accepts an honest uncertainty for the mandatory question", async ({ fixture, packId, dimension }) => {
    const fetchFn = vi.fn().mockResolvedValueOnce(success(answer(null, "The verified evidence does not state this.")));
    const settled = await run(fixture, packId, dimension, fetchFn).result;
    if (!settled.ok) throw new Error(settled.error.diagnosticReason);
    expect(settled.resolution.proposals).toEqual([
      expect.objectContaining({
        clauseId: QUESTION_ID,
        uncertainty: "The verified evidence does not state this.",
        references: [],
        studyStatus: "NOT_ACCEPTED",
      }),
    ]);
  });

  it.each(CASES)("$name rejects a hallucinated evidence digest after one retry", async ({ fixture, packId, dimension }) => {
    const fake = "a".repeat(64);
    const fetchFn = vi.fn().mockResolvedValueOnce(success(answer(fake, null))).mockResolvedValueOnce(success(answer(fake, null)));
    const settled = await run(fixture, packId, dimension, fetchFn).result;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(settled.ok).toBe(false);
    if (settled.ok) return;
    expect(settled.error).toMatchObject({ errorCode: "MODEL_OUTPUT_INVALID", diagnosticReason: "citation_unresolved" });
  });

  it.each(CASES)("$name rejects malformed output after one retry", async ({ fixture, packId, dimension }) => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(success({ schema: PACK_GUIDED_OUTPUT_SCHEMA, proposals: {} }))
      .mockResolvedValueOnce(success("text"));
    const settled = await run(fixture, packId, dimension, fetchFn).result;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    if (settled.ok) throw new Error("expected failure");
    expect(settled.error.diagnosticReason).toBe("output_malformed");
  });

  it.each(CASES)("$name rejects a missing mandatory answer after one retry", async ({ fixture, packId, dimension }) => {
    const preview = prepared(fixture, packId, dimension);
    const digest = preview.evidence.index.records[0]?.recordDigest ?? "";
    const missing = {
      schema: PACK_GUIDED_OUTPUT_SCHEMA,
      proposals: [{
        proposalId: "proposal:field",
        clauseId: "entity:subject",
        kind: "FIELD",
        evidenceRecordDigests: [digest],
        claim: { fieldId: "name" },
        uncertainty: null,
      }],
    };
    const fetchFn = vi.fn().mockResolvedValueOnce(success(missing)).mockResolvedValueOnce(success(missing));
    const settled = await run(fixture, packId, dimension, fetchFn).result;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    if (settled.ok) throw new Error("expected failure");
    expect(settled.error.diagnosticReason).toBe("mandatory_answer_missing");
  });

  it.each(CASES)("$name retries one unusable answer and then accepts the next", async ({ fixture, packId, dimension }) => {
    const preview = prepared(fixture, packId, dimension);
    const digest = preview.evidence.index.records[0]?.recordDigest;
    if (!digest) throw new Error("missing digest");
    const fetchFn = vi.fn().mockResolvedValueOnce(success(["not", "an", "object"])).mockResolvedValueOnce(success(answer(digest, null)));
    const settled = await run(fixture, packId, dimension, fetchFn).result;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String((fetchFn.mock.calls[1]?.[1] as RequestInit).body)) as { user_payload: { retryNote?: string } };
    expect(second.user_payload.retryNote).toContain("could not be used");
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.calls.map((call) => call.outcome)).toEqual(["unparseable", "ok"]);
  });

  it.each(CASES)("$name returns a provider failure without a second model call", async ({ fixture, packId, dimension }) => {
    const fetchFn = vi.fn().mockResolvedValueOnce(failure(503, "MODEL_UNAVAILABLE", "planner_unavailable"));
    const settled = await run(fixture, packId, dimension, fetchFn).result;
    expect(fetchFn).toHaveBeenCalledTimes(1);
    if (settled.ok) throw new Error("expected failure");
    expect(settled.error).toMatchObject({ errorCode: "MODEL_UNAVAILABLE", diagnosticReason: "planner_unavailable" });
  });

  it.each(CASES)("$name denies recorded authorization when the pages are not the synthetic fixture", async ({ fixture, packId, dimension }) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetchFn = vi.fn();
    const realText = "A different real record that must stay off the model.";
    const { result } = run(fixture, packId, dimension, fetchFn, {
      pages: [{ ...prepared(fixture, packId, dimension).page, text: realText }],
      disclosure: { decision: "AUTHORIZED", basis: "RECORDED_AUTHORIZATION" },
    });
    const settled = await result;
    log.mockRestore();
    expect(fetchFn).not.toHaveBeenCalled();
    if (settled.ok) throw new Error("expected denial");
    expect(settled.error).toMatchObject({
      errorCode: "ACCESS_DENIED",
      diagnosticReason: "privacy_denied",
      diagnosticField: "recorded_authorization_not_disclosure",
    });
    expect(log.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(realText);
    expect(log.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(fixture.quote);
  });

  it("does not treat a matching fixture's recorded-authorization flag as the permission", async () => {
    const fixture = SYNTHETIC_EXECUTION_FIXTURES[0]!;
    const preview = prepared(fixture, CASES[0]!.packId, CASES[0]!.dimension);
    const digest = preview.evidence.index.records[0]?.recordDigest;
    if (!digest) throw new Error("missing digest");
    const fetchFn = vi.fn().mockResolvedValueOnce(success(answer(digest, null)));
    const settled = await run(fixture, CASES[0]!.packId, CASES[0]!.dimension, fetchFn, {
      disclosure: { decision: "AUTHORIZED", basis: "RECORDED_AUTHORIZATION" },
    }).result;
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(settled.ok).toBe(true);
  });

  it.each(CASES)("$name rejects saved evidence that does not match the frozen pages", async ({ fixture, packId, dimension }) => {
    const fetchFn = vi.fn();
    const settled = await run(fixture, packId, dimension, fetchFn, {
      evidence: { schema: "hive.extraction-evidence-verification/1" },
    }).result;
    expect(fetchFn).not.toHaveBeenCalled();
    if (settled.ok) throw new Error("expected failure");
    expect(settled.error).toMatchObject({ errorCode: "INVALID_REQUEST", diagnosticReason: "evidence_snapshot_mismatch" });
  });

  it.each(CASES)("$name rejects a model quotation after one retry", async ({ fixture, packId, dimension }) => {
    const preview = prepared(fixture, packId, dimension);
    const digest = preview.evidence.index.records[0]?.recordDigest ?? "";
    const quoted = {
      schema: PACK_GUIDED_OUTPUT_SCHEMA,
      proposals: [{
        proposalId: "proposal:question",
        clauseId: QUESTION_ID,
        kind: "STATEMENT",
        evidenceRecordDigests: [digest],
        claim: { questionId: QUESTION_ID, note: fixture.quote },
        uncertainty: null,
      }],
    };
    const fetchFn = vi.fn().mockResolvedValueOnce(success(quoted)).mockResolvedValueOnce(success(quoted));
    const settled = await run(fixture, packId, dimension, fetchFn).result;
    expect(fetchFn).toHaveBeenCalledTimes(2);
    if (settled.ok) throw new Error("expected failure");
    expect(settled.error.diagnosticReason).toBe("model_quotation");
  });

  it("stops before the model when the mandatory prompt exceeds the request ceiling", async () => {
    const fixture = SYNTHETIC_EXECUTION_FIXTURES[0]!;
    const fetchFn = vi.fn();
    const settled = await run(fixture, CASES[0]!.packId, CASES[0]!.dimension, fetchFn, {
      limits: { maxRequestBytes: 40 },
    }).result;
    expect(fetchFn).not.toHaveBeenCalled();
    if (settled.ok) throw new Error("expected capacity failure");
    expect(settled.error.diagnosticReason).toBe("prompt_capacity");
  });
});
