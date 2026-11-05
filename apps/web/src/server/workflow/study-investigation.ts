import {
  createHiveError,
  estimateStudyAgentUsd,
  formatStudyAgentBudgetDiagnosticField,
  formatStudyAgentRejectionSummary,
  type HiveError,
  STUDY_AGENT_BUDGET,
  type StudyAgentBudgetDimension,
  STUDY_AGENT_TOOLS,
  studyAgentAllowance,
  type StudyAgentCorpusPage,
  StudyAgentLedger,
  type StudyAgentMessage,
  type StudyAgentTurnRequest,
  type StudyInvestigationOutput,
} from "@hiveforyou/contracts";

import { emitStructuredEvent } from "@/server/observability/logger";
import { callStudyAgentTurn, type PlannerDeps } from "@/server/study-preparation/planner-client";

/**
 * Canonical Study investigation loop (D-042, V4-004I). Runs native tool-calling turns through the Oracle
 * planner and executes every tool call in the in-memory `StudyAgentLedger`, under hard budgets.
 * The ledger lives for one stage attempt: a retried stage starts a fresh investigation. Nothing
 * here is durable or resumable; the caller verifies and persists only a finished Study.
 */

const START_MESSAGE =
  "Investigate the authorized case corpus using the tools, following the strict dependency order in the instructions above — never predict E... or DF... identifiers before a tool result returns them: (1) call read_pages first (and search_case when needed) to read all authorized non-empty pages of PRIMARY documents; (2) after read_pages returns page text, batch record_evidence using exact consecutive runs copied from that returned text (never from search_case snippets; when a page is truncated, quote only from the returned portion or read the rest with read_pages) and wait for confirmed E... ids; (3) using only confirmed returned E... ids, call record_document for every authorized document (PRIMARY, SUPPORTING, REFERENCE or UNCERTAIN; documentType UNDETERMINED with role UNCERTAIN when the type cannot be established) and batch record_document_finding to record reusable atomic DF... findings once per document without predicting DF... ids — split large batches across turns if needed, up to the per-turn tool limit; (4) using only confirmed returned DF... ids, record relationships, calculations (record_calculation), contradictions (flag_conflict), assessments (record_assessment), and open professional determinations (record_professional_determination) without duplicate record_fact calls; (5) close every investigation question briefly with finish_question citing confirmed DF... findingIds, listing its evidenceNeeds (FOUND, NOT_FOUND, UNCERTAIN or NOT_REQUIRED) and preserving uncertainties and limitations, then call finish_study once with one documentReconciliations entry per document, without claiming that full page coverage proves complete semantic extraction.";
const NUDGE_MESSAGE =
  "No tool was called. Continue with the tools in dependency order: read all non-empty pages of PRIMARY documents with read_pages first, record exact quotes copied from read_pages output with record_evidence, use confirmed returned E... ids for record_document (every authorized document) and record_document_finding, then close every question briefly with finish_question citing confirmed DF... findingIds and evidenceNeeds without duplicate record_fact calls, and call finish_study with one documentReconciliations entry per document.";
const BUDGET_MESSAGE = "The analysis could not finish investigating your documents within its limits. You can try again.";

export type StudyAgentTotals = {
  rounds: number;
  roundsAllowed: number;
  toolCalls: number;
  invalidCalls: number;
  invalidBudgetUsed: number;
  rejectionCounts: Record<string, number>;
  rejectionSummary: string | null;
  questionsCompleted: number;
  questionsTotal: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  roundTripMs: number;
  modelAlias: string | null;
  resolvedModel: string | null;
  finishReason: string | null;
};

export class StudyAgentFailure extends Error {
  constructor(
    readonly hiveError: HiveError,
    readonly totals: StudyAgentTotals,
  ) {
    super(hiveError.diagnosticReason ?? hiveError.errorCode);
  }
}

export type StudyAgentInput = {
  readonly planner: PlannerDeps;
  readonly runId: string;
  readonly correlationId: string;
  readonly prompt: { readonly id: string; readonly digest: string; readonly systemPrompt: string };
  readonly questionIds: readonly string[];
  readonly pages: readonly StudyAgentCorpusPage[];
  /** Epoch ms by which the last turn must have returned; verification and persistence follow. */
  readonly deadline: number;
  readonly clock?: () => number;
};

export async function runStudyInvestigation(
  input: StudyAgentInput,
): Promise<{ study: StudyInvestigationOutput; totals: StudyAgentTotals }> {
  const clock = input.clock ?? Date.now;
  const startedAt = clock();
  const ledger = new StudyAgentLedger({ processingRunId: input.runId, planQuestionIds: input.questionIds, pages: input.pages });
  const allowance = studyAgentAllowance(
    input.questionIds.length,
    new Set(input.pages.map((page) => page.sourceDocumentId.toLowerCase())).size,
  );
  const messages: StudyAgentMessage[] = [{ role: "user", content: START_MESSAGE }];
  const totals: StudyAgentTotals = {
    rounds: 0,
    roundsAllowed: allowance.rounds,
    toolCalls: 0,
    invalidCalls: 0,
    invalidBudgetUsed: 0,
    rejectionCounts: {},
    rejectionSummary: null,
    questionsCompleted: 0,
    questionsTotal: input.questionIds.length,
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: 0,
    roundTripMs: 0,
    modelAlias: null,
    resolvedModel: null,
    finishReason: null,
  };
  const sync = () => {
    totals.toolCalls = ledger.toolCalls;
    totals.invalidCalls = ledger.invalidCalls;
    totals.invalidBudgetUsed = ledger.invalidBudgetUsed;
    totals.rejectionCounts = ledger.rejectionCounts;
    totals.rejectionSummary = formatStudyAgentRejectionSummary(totals.rejectionCounts);
    totals.questionsCompleted = ledger.completedQuestionCount;
  };
  const emitRejectionTelemetry = (turnCounts: Readonly<Record<string, number>>) => {
    const turnSummary = formatStudyAgentRejectionSummary(turnCounts);
    if (!turnSummary) return;
    const primaryReason = turnSummary.split(",")[0]?.split(":")[0] ?? "model_output_invalid";
    const turnRejectedUnits = Object.values(turnCounts).reduce((sum, count) => sum + count, 0);
    emitStructuredEvent({
      eventName: "study.turn.rejected",
      severity: "WARN",
      timestamp: new Date().toISOString(),
      component: "analysis",
      operation: "investigate",
      stage: "ANALYZE",
      task: "study",
      correlationId: input.correlationId,
      processingRunId: input.runId,
      durationMs: Math.max(0, Math.trunc(clock() - startedAt)),
      rounds: totals.rounds,
      rejectedUnits: turnRejectedUnits,
      diagnosticReason: primaryReason,
      rejectionSummary: turnSummary,
    });
  };
  const exhausted = (limit: StudyAgentBudgetDimension): never => {
    sync();
    throw new StudyAgentFailure(
      createHiveError({
        errorCode: "MODEL_OUTPUT_INVALID",
        category: "MODEL",
        stage: "ANALYZE",
        retryable: false,
        safeMessage: BUDGET_MESSAGE,
        correlationId: input.correlationId,
        operationId: input.runId,
        diagnosticReason: "study_agent_budget_exhausted",
        diagnosticField: formatStudyAgentBudgetDiagnosticField({
          dimension: limit,
          roundsUsed: totals.rounds,
          roundsAllowed: totals.roundsAllowed,
          toolCalls: totals.toolCalls,
          invalidCalls: totals.invalidCalls,
          questionsCompleted: totals.questionsCompleted,
          questionsTotal: totals.questionsTotal,
        }),
      }),
      totals,
    );
  };

  while (!ledger.finished) {
    if (totals.rounds >= allowance.rounds) exhausted("rounds");
    if (ledger.toolCalls >= allowance.toolCalls) exhausted("tool_calls");
    if (ledger.invalidBudgetUsed >= allowance.invalidCalls) exhausted("invalid_calls");
    const outputTokens = Math.min(STUDY_AGENT_BUDGET.turnOutputTokens, STUDY_AGENT_BUDGET.maxOutputTokens - totals.completionTokens);
    if (outputTokens < STUDY_AGENT_BUDGET.minTurnOutputTokens) exhausted("output_tokens");

    const turnMs = Math.min(STUDY_AGENT_BUDGET.maxTurnMs, input.deadline - clock());
    if (turnMs < STUDY_AGENT_BUDGET.minTurnMs) exhausted("wall_clock");
    const request: Omit<StudyAgentTurnRequest, "contract_version"> = {
      prompt_id: input.prompt.id,
      prompt_digest: input.prompt.digest,
      system_prompt: input.prompt.systemPrompt,
      messages,
      tools: STUDY_AGENT_TOOLS,
      max_output_tokens: outputTokens,
      timeout_seconds: Math.floor((turnMs - STUDY_AGENT_BUDGET.turnAbortMarginMs) / 1000),
    };
    const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
    if (bytes > STUDY_AGENT_BUDGET.maxRequestBytes) exhausted("request_bytes");
    const estimatedInput = totals.promptTokens + Math.ceil(bytes / 3);
    if (estimatedInput > STUDY_AGENT_BUDGET.maxInputTokens) exhausted("input_tokens");
    if (estimateStudyAgentUsd(estimatedInput, totals.completionTokens + outputTokens) > STUDY_AGENT_BUDGET.maxEstimatedUsd) {
      exhausted("estimated_cost");
    }

    let turn: Awaited<ReturnType<typeof callStudyAgentTurn>>;
    try {
      turn = await callStudyAgentTurn(input.planner, {
        request,
        abortMs: turnMs,
        correlationId: input.correlationId,
        processingRunId: input.runId,
      });
    } catch (error) {
      sync();
      if (error && typeof error === "object" && "errorCode" in error) throw new StudyAgentFailure(error as HiveError, totals);
      throw error;
    }
    totals.rounds += 1;
    totals.promptTokens += turn.usage.promptTokens ?? Math.ceil(bytes / 3);
    totals.completionTokens += turn.usage.completionTokens ?? outputTokens;
    totals.latencyMs += turn.latencyMs;
    totals.roundTripMs += turn.roundTripMs;
    totals.modelAlias = turn.modelAlias;
    totals.resolvedModel = turn.resolvedModel ?? totals.resolvedModel;
    totals.finishReason = turn.finishReason;
    if (clock() > input.deadline) exhausted("wall_clock");

    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: turn.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
    });
    if (turn.toolCalls.length === 0) {
      ledger.noteInvalidTurn();
      sync();
      emitRejectionTelemetry(ledger.lastTurnRejectionCounts);
      messages.push({ role: "user", content: NUDGE_MESSAGE });
      continue;
    }
    ledger.beginTurn();
    turn.toolCalls.forEach((call, index) => {
      const result =
        index >= STUDY_AGENT_BUDGET.maxCallsPerTurn
          ? ledger.decline(
              call,
              "too_many_calls",
              `At most ${STUDY_AGENT_BUDGET.maxCallsPerTurn} tool calls per turn; batch independent calls but split across turns when needed.`,
            )
          : ledger.finished
            ? ledger.decline(call, "study_finished", "The study is already finished.")
            : ledger.execute(call);
      messages.push({ role: "tool", tool_call_id: result.toolCallId, content: result.content });
    });
    sync();
    emitRejectionTelemetry(ledger.lastTurnRejectionCounts);
  }
  sync();
  return { study: ledger.assemble(), totals };
}

/**
 * `hive.source-page-index/1`: the case corpus the tools search and read, in manifest order. Page
 * text is not included; the model reaches it only through `read_pages`.
 */
export function renderSourcePageIndex(pages: readonly StudyAgentCorpusPage[]): string {
  const documents = new Map<string, { pages: number[]; characters: number; empty: number[] }>();
  for (const page of pages) {
    const entry = documents.get(page.sourceDocumentId) ?? { pages: [], characters: 0, empty: [] };
    entry.pages.push(page.pageNumber);
    entry.characters += page.text.length;
    if (page.text.trim() === "") entry.empty.push(page.pageNumber);
    documents.set(page.sourceDocumentId, entry);
  }
  const lines = [...documents.entries()].map(([id, entry]) => {
    const empty = entry.empty.length > 0 ? ` · no text on ${ranges(entry.empty)}` : "";
    return `- documentId ${id} · pages ${ranges(entry.pages)} · ${entry.characters} characters${empty}`;
  });
  return [`${pages.length} authorized pages in ${documents.size} documents:`, ...lines].join("\n");
}

function ranges(numbers: readonly number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j += 1;
    parts.push(j === i ? String(sorted[i]) : `${sorted[i]}-${sorted[j]}`);
    i = j;
  }
  return parts.join(", ");
}
