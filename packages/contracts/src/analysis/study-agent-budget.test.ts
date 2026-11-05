import { describe, expect, it } from "vitest";

import { MAYA_DOCS, MAYA_RUN_ID } from "../testing/maya-fixture";
import {
  estimateStudyAgentUsd,
  STUDY_AGENT_BUDGET,
  StudyAgentLedger,
  studyAgentAllowance,
  studyAgentMaxEstimatedUsd,
} from "./study-agent";
import { normalizeQuoteText } from "./study-verification";

/** Vercel route / worker lease (seconds). */
const VERCEL_MAX_DURATION_S = 300;
/** TLS reverse-proxy read timeout documented in `infra/oracle/PLANNER-DOCKER.md`. */
const PROXY_READ_TIMEOUT_S = 290;
/** Oracle `StudyAgentTurnRequest.timeout_seconds` maximum (`v4_planner.py`). */
const PLANNER_TURN_TIMEOUT_MAX_S = 240;
/** Web abort per turn (`PLANNER_HTTP_TIMEOUT_MS`). */
const PLANNER_HTTP_ABORT_MS = 160_000;

describe("Study agent execution budget (offline regression)", () => {
  it("keeps hard ceilings below upstream infrastructure deadlines", () => {
    expect(STUDY_AGENT_BUDGET.wallClockMs / 1000).toBeLessThanOrEqual(VERCEL_MAX_DURATION_S - 25);
    expect(STUDY_AGENT_BUDGET.maxTurnMs / 1000 + STUDY_AGENT_BUDGET.turnAbortMarginMs / 1000).toBeLessThanOrEqual(
      PROXY_READ_TIMEOUT_S,
    );
    expect(STUDY_AGENT_BUDGET.maxTurnMs / 1000).toBeLessThanOrEqual(PLANNER_TURN_TIMEOUT_MAX_S);
    expect(STUDY_AGENT_BUDGET.maxTurnMs + STUDY_AGENT_BUDGET.turnAbortMarginMs).toBeLessThanOrEqual(PLANNER_HTTP_ABORT_MS);
    expect(STUDY_AGENT_BUDGET.maxCallsPerTurn).toBeLessThanOrEqual(32);
  });

  it("allocates L001-shaped eight-document / seven-question headroom beyond the observed wall-clock failure", () => {
    const allowance = studyAgentAllowance(7, 8);
    expect(allowance).toEqual({ rounds: 25, toolCalls: 166, invalidCalls: 19 });
    expect(allowance.rounds).toBeGreaterThan(21);
    expect(STUDY_AGENT_BUDGET.wallClockMs).toBeGreaterThan(235_000);
  });

  it("caps estimated spend at the configured USD ceiling before token ceilings would bind", () => {
    expect(studyAgentMaxEstimatedUsd()).toBe(STUDY_AGENT_BUDGET.maxEstimatedUsd);
    const atInputCeiling = estimateStudyAgentUsd(STUDY_AGENT_BUDGET.maxInputTokens, STUDY_AGENT_BUDGET.maxOutputTokens);
    expect(atInputCeiling).toBeGreaterThan(STUDY_AGENT_BUDGET.maxEstimatedUsd);
    expect(estimateStudyAgentUsd(640_000, 30_000)).toBeLessThanOrEqual(STUDY_AGENT_BUDGET.maxEstimatedUsd);
  });

  it("would not terminate the observed L001 failure on rounds or tool calls alone (wall clock was the limit)", () => {
    const allowance = studyAgentAllowance(7, 8);
    const observed = { rounds: 9, toolCalls: 97 };
    expect(observed.rounds).toBeLessThan(allowance.rounds);
    expect(observed.toolCalls).toBeLessThan(allowance.toolCalls);
  });
});

describe("Study agent quote normalization (strict provenance)", () => {
  const pageText = 'Baseline: 42 words correct per minute. Target: 75 WCPM.';
  const corpus = [{ sourceDocumentId: MAYA_DOCS.iep2025, pageNumber: 1, text: pageText }];

  let quoteCallSeq = 0;
  function recordQuote(ledger: StudyAgentLedger, quote: string) {
    quoteCallSeq += 1;
    const result = ledger.execute({
      id: `q${quoteCallSeq}`,
      name: "record_evidence",
      arguments: JSON.stringify({ documentId: MAYA_DOCS.iep2025, pageNumber: 1, quote }),
    });
    return JSON.parse(result.content) as { ok: boolean; error?: string };
  }

  it("does not accept paraphrases or synonym substitution after typographic normalization", () => {
    expect(normalizeQuoteText("42 words per minute")).not.toEqual(normalizeQuoteText(pageText));
    const ledger = new StudyAgentLedger({ processingRunId: MAYA_RUN_ID, planQuestionIds: ["P1"], pages: corpus });
    ledger.execute({
      id: "r1",
      name: "read_pages",
      arguments: JSON.stringify({ documentId: MAYA_DOCS.iep2025, fromPage: 1, toPage: 1 }),
    });
    expect(recordQuote(ledger, "approximately 42 words correct per minute")).toMatchObject({
      ok: false,
      error: "quote_not_on_page",
    });
    expect(recordQuote(ledger, "Baseline: 43 words correct per minute.")).toMatchObject({
      ok: false,
      error: "quote_not_on_page",
    });
  });

  it("rejects quotes from unread pages and unauthorized documents", () => {
    const ledger = new StudyAgentLedger({ processingRunId: MAYA_RUN_ID, planQuestionIds: ["P1"], pages: corpus });
    expect(recordQuote(ledger, "Baseline: 42 words correct per minute.")).toMatchObject({
      ok: false,
      error: "page_not_read",
    });
    const unauthorized = ledger.execute({
      id: "u1",
      name: "record_evidence",
      arguments: JSON.stringify({
        documentId: "00000000-0000-4000-8000-000000000000",
        pageNumber: 1,
        quote: "anything",
      }),
    });
    expect(unauthorized.ok).toBe(false);
    expect(JSON.parse(unauthorized.content) as { error: string }).toMatchObject({ error: "page_not_authorized" });
  });
});
