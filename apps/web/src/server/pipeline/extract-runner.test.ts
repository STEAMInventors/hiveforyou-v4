import { PLANNER_CONTRACT_VERSION } from "@hiveforyou/contracts";
import { describe, expect, it, vi } from "vitest";

import { loadPromptCatalog } from "@/server/study-preparation/prompt-catalog";

import { extractDocument, renderExtractUserMessage } from "./extract-runner";

const DOC = { id: "abcdef12-3456-4789-8abc-def012345678", fileName: "01_plan.pdf" };
const CORRELATION_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const config = { baseUrl: "https://planner.example.test", serviceToken: "t", timeoutMs: 1000 };

const pages = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ pageNumber: i + 1, text: `Page ${i + 1} says the payment is $${i + 1}00.00 per month.` }));

const answer = (facts: { id: string; page: number; quote: string }[]) => ({
  schema: "hive.doc-extraction/1",
  facts: facts.map((f) => ({
    id: f.id,
    category: "payment",
    subject: "Plan payment",
    attribute: "amount",
    valueAsWritten: "$100.00",
    modality: "stated",
    evidence: [{ page: f.page, quote: f.quote }],
  })),
  emptyFields: [],
  referencedDocuments: [],
  coverage: { pageCount: 1, pagesRead: [1], truncated: false, lastPageCompleted: 1 },
});

const success = (content: unknown) =>
  new Response(
    JSON.stringify({
      contract_version: PLANNER_CONTRACT_VERSION,
      task: "extract",
      model_alias: "harvester",
      resolved_model: "model-x",
      content_json: content,
      usage: { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200 },
      latency_ms: 1500,
      finish_reason: "stop",
    }),
    { status: 200 },
  );

const failure = (status: number, errorCode: string, reason: string) =>
  new Response(
    JSON.stringify({ contract_version: "planner-error@1", error_code: errorCode, retryable: false, diagnostic_reason: reason }),
    { status },
  );

function run(fetchFn: ReturnType<typeof vi.fn>, pageCount = 2) {
  return extractDocument({
    planner: { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
    document: DOC,
    pages: pages(pageCount),
    correlationId: CORRELATION_ID,
    runId: RUN_ID,
  });
}

const sentMessage = (fetchFn: ReturnType<typeof vi.fn>, call: number) =>
  (JSON.parse((fetchFn.mock.calls[call]![1] as RequestInit).body as string) as { user_payload: { message: string } })
    .user_payload.message;

describe("renderExtractUserMessage", () => {
  it("fills the hive-extract/1 user template with page markers and keeps $ text verbatim", () => {
    const message = renderExtractUserMessage(loadPromptCatalog().extract.userTemplate, {
      documentId: DOC.id,
      fileName: DOC.fileName,
      pageRange: null,
      pages: [{ pageNumber: 1, text: "Pay $640.00 per month $&" }],
    });
    expect(message).toContain(`Document id: \`${DOC.id}\``);
    expect(message).toContain("Page range: `all`");
    expect(message).toContain("=== PAGE 1 ===\nPay $640.00 per month $&");
    expect(message).toContain("Return only the JSON.");
    expect(message).not.toMatch(/\{\{/);
  });
});

describe("extractDocument", () => {
  it("sends the extract task, verifies quotes and assigns final ids", async () => {
    const fetchFn = vi.fn(async () =>
      success(
        answer([
          { id: "F001", page: 1, quote: "Page 1 says the payment is $100.00 per month." },
          { id: "F002", page: 2, quote: "the payment is $999.00 per month" },
          { id: "F003", page: 2, quote: "Page 2 says the payment is $200.00" },
        ]),
      ),
    );
    const result = await run(fetchFn);
    if (!result.ok) throw new Error(result.error.diagnosticReason);
    const body = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({ task: "extract", prompt_id: "hive-extract/1", max_output_tokens: 16000 });
    expect(body.system_prompt).toContain("No quote, no fact.");
    expect(result.extraction.facts.map((f) => [f.id, f.modelId])).toEqual([
      ["F-abcdef12-001", "F001"],
      ["F-abcdef12-002", "F003"],
    ]);
    expect(result.extraction.documentId).toBe(DOC.id);
    expect(result.stats).toMatchObject({ factsProposed: 3, factsIn: 3, factsKept: 2, byReason: { quote_not_found: 1 } });
    expect(result.calls).toEqual([
      expect.objectContaining({ attempt: 1, outcome: "ok", outputTokens: 300, latencyMs: 1500, finishReason: "stop" }),
    ]);
  });

  it("retries an unparseable answer once with the reason appended", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(failure(422, "MODEL_OUTPUT_INVALID", "model_output_not_json"))
      .mockResolvedValueOnce(success(answer([{ id: "F001", page: 1, quote: "Page 1 says" }])));
    const result = await run(fetchFn);
    expect(result.ok).toBe(true);
    expect(sentMessage(fetchFn, 0)).not.toContain("could not be used");
    expect(sentMessage(fetchFn, 1)).toContain("Your previous answer could not be used (model_output_not_json)");
    expect(result.calls.map((c) => [c.attempt, c.outcome])).toEqual([
      [1, "unparseable"],
      [2, "ok"],
    ]);
  });

  it("fails after a second unusable answer, including a non-object root", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(success(["not", "an", "object"]))
      .mockResolvedValueOnce(failure(422, "MODEL_OUTPUT_INVALID", "model_output_not_json"));
    const result = await run(fetchFn);
    expect(result).toMatchObject({ ok: false, error: { stage: "EXTRACT", diagnosticReason: "extraction_unparseable_after_retry" } });
    expect(sentMessage(fetchFn, 1)).toContain("The answer is not a JSON object.");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry a timeout", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(failure(504, "MODEL_TIMEOUT", "litellm_timeout"));
    const result = await run(fetchFn, 1);
    expect(result.ok).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.calls[0]).toMatchObject({ outcome: "failed" });
  });

  it("splits a timed-out multi-page range in half until both halves succeed", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const message = (JSON.parse(init.body as string) as { user_payload: { message: string } }).user_payload.message;
      const range = /Page range: `([^`]+)`/.exec(message)![1]!;
      if (range === "all") return failure(504, "MODEL_TIMEOUT", "litellm_timeout");
      const first = Number(range.split("-")[0]);
      return success(answer([{ id: `F${range}`, page: first, quote: `Page ${first} says` }]));
    });
    const result = await run(fetchFn, 3);
    if (!result.ok) throw new Error(result.error.diagnosticReason);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("splits a truncated multi-page range in half until both halves succeed", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const message = (JSON.parse(init.body as string) as { user_payload: { message: string } }).user_payload.message;
      const range = /Page range: `([^`]+)`/.exec(message)![1]!;
      if (range === "all") return failure(422, "MODEL_OUTPUT_INVALID", "model_output_truncated");
      const first = Number(range.split("-")[0]);
      return success(answer([{ id: `F${range}`, page: first, quote: `Page ${first} says` }]));
    });
    const result = await run(fetchFn, 3);
    if (!result.ok) throw new Error(result.error.diagnosticReason);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.extraction.facts).toHaveLength(2);
    expect(result.stats.pageExtractionGaps).toEqual([]);
  });

  it("records a page extraction gap when a single page still truncates and keeps the run going", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(failure(422, "MODEL_OUTPUT_INVALID", "model_output_truncated"));
    const result = await run(fetchFn, 1);
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.stats.pageExtractionGaps).toEqual([1]);
    expect(result.extraction.facts).toEqual([]);
    expect(result.extraction.coverage.pagesBlankOrUnreadable).toEqual([1]);
  });

  it("uses size-driven ranges for long documents and verifies each against its own pages", async () => {
    const denseText = `Page says the payment is $100.00 per month. ${"detail ".repeat(400)}`;
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const message = (JSON.parse(init.body as string) as { user_payload: { message: string } }).user_payload.message;
      const range = /Page range: `([^`]+)`/.exec(message)![1]!;
      const first = Number(range.split("-")[0]);
      return success(
        answer([
          { id: `p${range}:F001`, page: first, quote: denseText.slice(0, 40) },
          { id: `p${range}:F002`, page: first, quote: denseText.slice(0, 40) },
        ]),
      );
    });
    const pageList = Array.from({ length: 45 }, (_, index) => ({
      pageNumber: index + 1,
      text: denseText.replace("$100", `$${index + 1}00`),
    }));
    const result = await extractDocument({
      planner: { getConfig: () => config, fetchFn: fetchFn as unknown as typeof fetch },
      document: DOC,
      pages: pageList,
      correlationId: CORRELATION_ID,
      runId: RUN_ID,
    });
    if (!result.ok) throw new Error(result.error.diagnosticReason);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
    expect(result.extraction.coverage.pageCount).toBe(45);
    expect(result.extraction.pageRange).toBeNull();
  });

});
