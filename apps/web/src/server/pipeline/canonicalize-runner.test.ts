import { type DocExtraction, estimateInputTokensFromUtf8Bytes, PLANNER_CONTRACT_VERSION, validateDocExtraction } from "@hiveforyou/contracts";
import { describe, expect, it, vi } from "vitest";

import { buildCanonicalizePayload, canonicalizeCase, draftDomainBrief } from "./canonicalize-runner";

const CORRELATION_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const config = { baseUrl: "https://planner.example.test", serviceToken: "t", timeoutMs: 1000 };

function extraction(documentId: string, fileName: string, factIds: string[]): DocExtraction {
  const validated = validateDocExtraction(
    {
      document: { titleAsPrinted: "Notice", documentType: "notice", issuer: { name: "Office" }, summary: "A notice." },
      facts: factIds.map((id) => ({
        id,
        subject: "Payment",
        attribute: "amount",
        valueAsWritten: "$100.00",
        modality: "stated",
        timeframe: { from: "2026-01-01", to: null, asWritten: null },
        evidence: [
          { page: 2, quote: "The payment is $100.00." },
          { page: 3, quote: "Repeated later." },
        ],
      })),
      emptyFields: [{ id: "E-x", label: "Signature", page: 1, quote: "Signature: ____" }],
      referencedDocuments: [{ id: "R-x", description: "Prior letter", page: 1, quote: "see prior letter" }],
    },
    { documentId, fileName, pageRange: null },
  );
  if (!validated.ok) throw new Error("fixture");
  return validated.value;
}

const EXTRACTIONS = [
  extraction("aaaa0001-0000-4000-8000-000000000001", "01_a.pdf", ["F-aaaa0001-001"]),
  extraction("bbbb0002-0000-4000-8000-000000000002", "02_b.pdf", ["F-bbbb0002-001"]),
];

const success = (content: unknown) =>
  new Response(
    JSON.stringify({
      contract_version: PLANNER_CONTRACT_VERSION,
      task: "canonicalize",
      model_alias: "heavy_lifter",
      resolved_model: "model-x",
      content_json: content,
      usage: { prompt_tokens: 9000, completion_tokens: 3000, total_tokens: 12000 },
      latency_ms: 40000,
      finish_reason: "stop",
    }),
    { status: 200 },
  );

const failure = (status: number, errorCode: string, reason: string) =>
  new Response(
    JSON.stringify({ contract_version: "planner-error@1", error_code: errorCode, retryable: false, diagnostic_reason: reason }),
    { status },
  );

const study = {
  spineSource: "ANCHOR",
  documents: [{ sourceDocumentId: EXTRACTIONS[0]!.documentId, role: "ANCHOR", typeInPlainWords: "notice" }],
  spine: [
    { id: "S9", label: "Payment of $100.00", kind: "figure", status: "SUPPORTED", supportingFactIds: ["F-aaaa0001-001"] },
    { id: "S10", label: "Invented", kind: "claim", status: "SUPPORTED", supportingFactIds: ["F-zzzz-001"] },
  ],
  conflicts: [{ id: "K", statement: "Disagree", factIds: ["F-aaaa0001-001", "E-x"] }],
  gaps: [{ id: "G", statement: "Prior letter not supplied", relatedSpineIds: ["S9"] }],
};

const sentPayload = (fetchFn: ReturnType<typeof vi.fn>, call: number) =>
  (JSON.parse((fetchFn.mock.calls[call]![1] as RequestInit).body as string) as { user_payload: Record<string, unknown>; task: string; prompt_id: string });

function run(fetchFn: ReturnType<typeof vi.fn>, domainBrief: string | null = null) {
  return canonicalizeCase({
    planner: { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
    extractions: EXTRACTIONS,
    domainBrief,
    correlationId: CORRELATION_ID,
    runId: RUN_ID,
  });
}

describe("buildCanonicalizePayload", () => {
  it("omits quote text and sends short refs (quotes stay in the database)", () => {
    const slim = buildCanonicalizePayload(EXTRACTIONS, null);
    const encoded = JSON.stringify(slim);
    expect(encoded).not.toContain("quote");
    expect(slim.documents[0]?.facts[0]).toMatchObject({
      ref: { documentId: EXTRACTIONS[0]!.documentId, page: 2, factId: "F-aaaa0001-001" },
    });
    void estimateInputTokensFromUtf8Bytes(encoded.length);
  });

  it("includes uploadedToFill on documents uploaded for a gap slot", () => {
    const docId = EXTRACTIONS[0]!.documentId;
    const payload = buildCanonicalizePayload(EXTRACTIONS, null, [
      {
        sourceDocumentId: docId,
        studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        gapId: "X3",
        gapTitle: "Pay stubs (March–April 2026)",
      },
    ]);
    expect(payload.documents[0]?.uploadedToFill).toBe("uploaded to fill: Pay stubs (March–April 2026)");
  });

  it("sends compact facts with short references and no empty fields", () => {
    const payload = buildCanonicalizePayload(EXTRACTIONS, null);
    expect(payload.domainBrief).toBeNull();
    expect(payload.documents[0]).toEqual({
      sourceDocumentId: EXTRACTIONS[0]!.documentId,
      fileName: "01_a.pdf",
      identity: { titleAsPrinted: "Notice", documentType: "notice", issuer: "Office", people: [], keyDates: [], summary: "A notice." },
      facts: [
        {
          id: "F-aaaa0001-001",
          subject: "Payment",
          attribute: "amount",
          valueAsWritten: "$100.00",
          timeframe: "2026-01-01 to ?",
          modality: "stated",
          ref: { documentId: EXTRACTIONS[0]!.documentId, page: 2, factId: "F-aaaa0001-001" },
        },
      ],
      emptyFields: [{ id: "E-x", label: "Signature", page: 1 }],
      referencedDocuments: [{ id: "R-x", description: "Prior letter", page: 1 }],
    });
  });
});

describe("canonicalizeCase", () => {
  it("makes one canonicalize call, assigns ids and verifies fact ids against the case", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(success(study));
    const result = await run(fetchFn, "  Ten lines of background.  ");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const sent = sentPayload(fetchFn, 0);
    expect(sent).toMatchObject({ task: "canonicalize", prompt_id: "hive-canonicalize/1" });
    expect(sent.user_payload.domainBrief).toBe("Ten lines of background.");
    if (!result.ok) throw new Error("expected ok");
    expect(result.study.spine.map((s) => [s.id, s.status])).toEqual([
      ["S1", "SUPPORTED"],
      ["S2", "UNSUPPORTED"],
    ]);
    expect(result.study.conflicts).toEqual([]);
    expect(result.study.gaps).toEqual([
      {
        id: "X1",
        statement: "Prior letter not supplied",
        relatedSpineIds: ["S1"],
        kind: null,
        title: "",
        why: "",
        holder: "",
        holderType: null,
        when: null,
        basisType: null,
        relatedFactIds: [],
      },
    ]);
    expect(result.drops).toMatchObject({ unknownFactIds: 2, spineMarkedUnsupported: 1, conflictsDropped: 1 });
    expect(result.calls).toEqual([expect.objectContaining({ purpose: "canonicalize", attempt: 1, outcome: "ok", inputTokens: 9000, outputTokens: 3000 })]);
  });

  it("retries an unusable answer once with the reason, then succeeds", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(success(["not", "an", "object"])).mockResolvedValueOnce(success(study));
    const result = await run(fetchFn);
    expect(result.ok).toBe(true);
    expect(sentPayload(fetchFn, 0).user_payload.retryNote).toBeUndefined();
    expect(sentPayload(fetchFn, 1).user_payload.retryNote).toContain("could not be used");
    expect(result.calls.map((c) => c.outcome)).toEqual(["unparseable", "ok"]);
  });

  it("fails after a second unusable answer", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(failure(502, "MODEL_OUTPUT_INVALID", "model_output_not_json"))
      .mockResolvedValueOnce(success("text"));
    const result = await run(fetchFn);
    expect(result).toMatchObject({ ok: false, error: { errorCode: "MODEL_OUTPUT_INVALID", diagnosticReason: "canonicalize_unparseable_after_retry" } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("drops gaps filled by slot upload using normalized title, not stale gap id", async () => {
    const studyWithFilledGap = {
      ...study,
      gaps: [
        { id: "G", statement: "Prior letter not supplied", relatedSpineIds: ["S9"] },
        { id: "H", statement: "Pay stubs missing", title: "Pay stubs (March–April 2026)", relatedSpineIds: [] },
        { id: "I", statement: "Bank statements missing", title: "Bank statements", relatedSpineIds: [] },
      ],
    };
    const fetchFn = vi.fn().mockResolvedValueOnce(success(studyWithFilledGap));
    const result = await canonicalizeCase({
      planner: { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
      extractions: EXTRACTIONS,
      gapFillLinks: [
        {
          sourceDocumentId: EXTRACTIONS[0]!.documentId,
          studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          gapId: "X3",
          gapTitle: "Pay stubs (March–April 2026)",
        },
      ],
      correlationId: CORRELATION_ID,
      runId: RUN_ID,
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.study.gaps.map((gap) => gap.title || gap.statement)).not.toContain("Pay stubs (March–April 2026)");
    expect(result.study.gaps.length).toBeGreaterThanOrEqual(1);
  });

  it("does not retry other planner failures", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(failure(504, "MODEL_TIMEOUT", "litellm_timeout"));
    const result = await run(fetchFn);
    expect(result).toMatchObject({ ok: false, error: { errorCode: "MODEL_TIMEOUT" } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("draftDomainBrief", () => {
  it("sends identity blocks only and joins the returned lines", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(success({ brief: ["Line one.", " ", "Line two."] }));
    const result = await draftDomainBrief({
      planner: { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
      extractions: EXTRACTIONS,
      correlationId: CORRELATION_ID,
      runId: RUN_ID,
    });
    expect(result).toMatchObject({ ok: true, brief: "Line one.\nLine two." });
    const sent = JSON.stringify(sentPayload(fetchFn, 0).user_payload);
    expect(sent).toContain("Notice");
    expect(sent).not.toContain("F-aaaa0001-001");
    expect(sent).not.toContain("$100.00");
  });
});
