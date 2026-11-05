import { CANONICAL_STUDY_SCHEMA, PLANNER_CONTRACT_VERSION, type CanonicalStudy } from "@hiveforyou/contracts";
import { describe, expect, it, vi } from "vitest";

import { buildWritePayload, writeStudyView } from "./write-runner";

const CORRELATION_ID = "77777777-7777-4777-8777-777777777777";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const config = { baseUrl: "https://planner.example.test", serviceToken: "t", timeoutMs: 1000 };

const study: CanonicalStudy = {
  schema: CANONICAL_STUDY_SCHEMA,
  domainLabel: "Example",
  spineSource: "ANCHOR",
  documents: [{ sourceDocumentId: "doc-a", role: "ANCHOR", typeInPlainWords: "Notice", date: null, version: null, chainPosition: null }],
  spine: [
    {
      id: "S1",
      label: "Amount",
      kind: "figure",
      status: "SUPPORTED",
      supportingFactIds: ["F-aaaa0001-001"],
      contradictingFactIds: [],
      updatingFactIds: [],
      missing: [],
    },
  ],
  outsideSpine: [],
  conflicts: [],
  timeline: [],
  gaps: [],
};

const facts = [
  {
    id: "F-aaaa0001-001",
    subject: "Fee",
    attribute: "amount",
    valueAsWritten: "$10.00",
    sourceDocumentId: "doc-a",
    pageNumber: 1,
    quote: "Fee $10.00",
  },
];

const writeAnswer = {
  sections: [{ heading: "Overview", paragraphs: [{ sentences: [{ text: "The fee is stated.", factIds: ["F-aaaa0001-001"] }] }] }],
  blocks: ["documents", "spine_table"],
};

const success = (content: unknown) =>
  new Response(
    JSON.stringify({
      contract_version: PLANNER_CONTRACT_VERSION,
      task: "write",
      model_alias: "harvester",
      resolved_model: "model-w",
      content_json: content,
      usage: { prompt_tokens: 4000, completion_tokens: 800, total_tokens: 4800 },
      latency_ms: 12000,
      finish_reason: "stop",
    }),
    { status: 200 },
  );

const failure = (status: number, errorCode: string, reason: string) =>
  new Response(
    JSON.stringify({ contract_version: "planner-error@1", error_code: errorCode, retryable: false, diagnostic_reason: reason }),
    { status },
  );

const sentPayload = (fetchFn: ReturnType<typeof vi.fn>, call: number) =>
  JSON.parse((fetchFn.mock.calls[call]![1] as RequestInit).body as string) as { user_payload: Record<string, unknown>; task: string; prompt_id: string };

describe("buildWritePayload", () => {
  it("sends canonical study and compact fact snippets without source document ids in facts", () => {
    const payload = buildWritePayload(study, facts, "CUSTOMER", "  A parent ", "  Understand fees ");
    expect(payload.reportRole).toBe("CUSTOMER");
    expect(payload.audience).toBe("A parent");
    expect(payload.intent).toBe("Understand fees");
    expect(payload.canonicalStudy).toBe(study);
    expect(payload.facts).toEqual([
      { id: "F-aaaa0001-001", subject: "Fee", attribute: "amount", valueAsWritten: "$10.00", quote: "Fee $10.00" },
    ]);
  });
});

describe("writeStudyView", () => {
  it("records tokens, latency, finish reason and resolved model on success", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(success(writeAnswer));
    const result = await writeStudyView({
      planner: { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
      canonicalStudy: study,
      facts,
      reportRole: "CUSTOMER",
      audience: "Parent",
      intent: "Understand the fee",
      correlationId: CORRELATION_ID,
      runId: RUN_ID,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sentPayload(fetchFn, 0)).toMatchObject({ task: "write", prompt_id: "hive-write/1" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.view.sections[0]!.heading).toBe("Overview");
    expect(result.calls).toEqual([
      expect.objectContaining({
        attempt: 1,
        outcome: "ok",
        inputTokens: 4000,
        outputTokens: 800,
        latencyMs: 12000,
        finishReason: "stop",
        resolvedModel: "model-w",
      }),
    ]);
  });

  it("retries unusable output once with the reason appended", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(success("not json")).mockResolvedValueOnce(success(writeAnswer));
    const result = await writeStudyView({
      planner: { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
      canonicalStudy: study,
      facts,
      reportRole: "CUSTOMER",
      audience: "Parent",
      intent: "Understand the fee",
      correlationId: CORRELATION_ID,
      runId: RUN_ID,
    });
    expect(result.ok).toBe(true);
    expect(sentPayload(fetchFn, 0).user_payload.retryNote).toBeUndefined();
    expect(sentPayload(fetchFn, 1).user_payload.retryNote).toContain("could not be used");
    expect(result.ok && result.calls.map((c) => c.outcome)).toEqual(["unparseable", "ok"]);
  });

  it("does not retry on timeout", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(failure(504, "MODEL_TIMEOUT", "litellm_timeout"));
    const result = await writeStudyView({
      planner: { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
      canonicalStudy: study,
      facts,
      reportRole: "CUSTOMER",
      audience: "Parent",
      intent: "Understand the fee",
      correlationId: CORRELATION_ID,
      runId: RUN_ID,
    });
    expect(result).toMatchObject({ ok: false, error: { errorCode: "MODEL_TIMEOUT" } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not retry on truncation", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(failure(502, "MODEL_OUTPUT_INVALID", "model_output_truncated"));
    const result = await writeStudyView({
      planner: { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
      canonicalStudy: study,
      facts,
      reportRole: "CUSTOMER",
      audience: "Parent",
      intent: "Understand the fee",
      correlationId: CORRELATION_ID,
      runId: RUN_ID,
    });
    expect(result).toMatchObject({ ok: false, error: { diagnosticReason: "model_output_truncated" } });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
