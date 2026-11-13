import { describe, expect, it } from "vitest";

import {
  buildFailureDiagnostic,
  buildUnexpectedExceptionDiagnostics,
  classifyFailure,
  diagnosticFieldFromMessage,
  normalizeFailureDiagnostic,
  normalizePlannerErrorEnvelope,
  normalizeSupportDiagnostics,
} from "./failure-diagnostic";

const diagnostic = {
  contractVersion: "failure-diagnostic@1" as const,
  component: "planner" as const,
  operation: "plan_completion",
  task: "study",
  stage: "INVESTIGATING",
  errorCode: "MODEL_OUTPUT_INVALID",
  diagnosticReason: "model_output_not_json",
  diagnosticField: null,
  retryable: true,
  attempt: 2,
};

describe("failure diagnostics", () => {
  it("keeps a safe planner envelope and drops model text", () => {
    const envelope = normalizePlannerErrorEnvelope({
      contract_version: "planner-error@1",
      error_code: "MODEL_OUTPUT_INVALID",
      retryable: true,
      correlation_id: "ac941441-5e0e-4ca4-818a-d8fe283d679b",
      processing_run_id: "325193b3-826e-4583-897e-71d1086530a0",
      task: "study",
      diagnostic_reason: "model_output_not_json",
      message_safe: "The planning answer was not JSON.",
      content: "{\"secret\":\"do not keep\"}",
    });
    expect(envelope).toEqual({
      contractVersion: "planner-error@1",
      errorCode: "MODEL_OUTPUT_INVALID",
      retryable: true,
      correlationId: "ac941441-5e0e-4ca4-818a-d8fe283d679b",
      processingRunId: "325193b3-826e-4583-897e-71d1086530a0",
      task: "study",
      diagnosticReason: "model_output_not_json",
    });
  });

  it("still reads a planner envelope from before diagnostic fields existed", () => {
    expect(normalizePlannerErrorEnvelope({ error_code: "MODEL_UNAVAILABLE", retryable: true })?.diagnosticReason).toBeNull();
  });

  it("classifies each workflow layer", () => {
    expect(classifyFailure({ stage: "INVESTIGATING", diagnosticReason: "model_output_truncated" })).toMatchObject({
      component: "planner",
      operation: "study_agent_turn",
      task: "study",
    });
    expect(classifyFailure({ stage: "WRITING", diagnosticReason: "model_output_truncated" })).toMatchObject({
      component: "planner",
      operation: "study_agent_turn",
      task: "writer",
    });
    expect(classifyFailure({ stage: "WRITING", diagnosticReason: "writer_agent_budget_exhausted" })).toEqual({
      component: "writer",
      operation: "write_report",
      task: "writer",
    });
    expect(classifyFailure({ stage: "INVESTIGATING", diagnosticReason: "study_agent_budget_exhausted" })).toEqual({
      component: "analysis",
      operation: "investigate",
      task: "study",
    });
    expect(classifyFailure({ stage: "UNDERSTANDING_REQUEST", diagnosticReason: "question_restates_intent" })).toMatchObject({
      component: "analysis",
      operation: "analyze_intent",
      task: "intent",
    });
    expect(classifyFailure({ stage: "READ", diagnosticReason: "reader_timeout" }).component).toBe("reader");
    expect(classifyFailure({ stage: "WRITING", diagnosticReason: "writer_scenario_invalid" }).component).toBe("scenario");
    expect(classifyFailure({ stage: "WRITING", diagnosticReason: "view_component_unknown" }).component).toBe("a2ui");
    expect(classifyFailure({ stage: "WRITING", diagnosticReason: "writer_claim_unknown" }).component).toBe("writer");
    expect(classifyFailure({ stage: "INVESTIGATING", diagnosticReason: "quotation_mismatch" }).operation).toBe("verify_study");
  });

  it("rejects diagnostics that carry free text", () => {
    expect(buildFailureDiagnostic({ ...diagnostic, diagnosticReason: "the model said hello" })).toBeNull();
    expect(normalizeFailureDiagnostic({ ...diagnostic, prompt: "system prompt" })).toEqual(diagnostic);
    expect(normalizeFailureDiagnostic({ ...diagnostic, diagnosticReason: "Not a token" })).toBeNull();
  });

  it("reads a field path from a schema error and ignores prose", () => {
    expect(diagnosticFieldFromMessage("answers[0].facts[0].quote is not an exact quotation from that page.")).toBe(
      "answers[0].facts[0].quote",
    );
    expect(diagnosticFieldFromMessage("The output schema is wrong.")).toBeUndefined();
  });

  it("summarizes unexpected TypeError throws with safe frames", () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'id')");
    error.stack = [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "    at processChunk (C:\\\\Users\\\\dev\\\\hiveforyou-v4\\\\apps\\\\web\\\\src\\\\server\\\\workflow\\\\report-generation.ts:42:11)",
      "    at runGeneration (C:\\\\Users\\\\dev\\\\hiveforyou-v4\\\\apps\\\\web\\\\src\\\\server\\\\workflow\\\\report-generation.ts:510:5)",
      "    at Object.<anonymous> (node:internal/modules/cjs/loader:999:12)",
    ].join("\n");

    const summary = buildUnexpectedExceptionDiagnostics(error);
    expect(summary.errorDetail).toContain("TypeError:");
    expect(summary.errorDetail).toContain("Cannot read properties of undefined");
    expect(summary.errorDetail).toContain("processChunk@workflow/report-generation.ts:42");
    expect(summary.errorDetail).toContain("runGeneration@workflow/report-generation.ts:510");
    expect(summary.errorDetail).not.toContain("C:\\\\Users");
    expect(summary.diagnosticField).toMatch(/^exception@TypeError@/);
    expect(summary.diagnosticField?.length).toBeLessThanOrEqual(128);
  });

  it("redacts long quoted document text from unexpected exception messages", () => {
    const documentText = "The operator requires extended time on all assessments per the review team.";
    const paddedQuote = `"${documentText} ${"x".repeat(20)}"`;
    const error = new Error(`Quote verification failed for ${paddedQuote}`);

    const summary = buildUnexpectedExceptionDiagnostics(error);
    expect(summary.errorDetail).toContain("[…]");
    expect(summary.errorDetail).not.toContain(documentText);
    expect(summary.diagnosticField).not.toContain(documentText.replace(/\s+/g, "_"));
  });

  it("returns only safe support rows", () => {
    const lookedUp = normalizeSupportDiagnostics({
      correlationId: "ac941441-5e0e-4ca4-818a-d8fe283d679b",
      diagnostics: [
        {
          kind: "processing_run",
          operationId: "325193b3-826e-4583-897e-71d1086530a0",
          status: "FAILED",
          prompt: "do not return",
          diagnostic: { ...diagnostic, modelResponse: "raw completion" },
        },
      ],
    });
    expect(lookedUp).toEqual({
      correlationId: "ac941441-5e0e-4ca4-818a-d8fe283d679b",
      diagnostics: [
        {
          kind: "processing_run",
          operationId: "325193b3-826e-4583-897e-71d1086530a0",
          status: "FAILED",
          diagnostic,
        },
      ],
    });
  });
});
