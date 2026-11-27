import {
  createHiveError,
  estimateStudyAgentUsd,
  formatStudyAgentBudgetDiagnosticField,
  type HiveError,
  STUDY_AGENT_BUDGET,
  type StudyAgentBudgetDimension,
  type StudyAgentMessage,
  type StudyAgentTurnRequest,
  type CompiledDomainPack,
  type DocExtraction,
  type DomainInvestigationPlan,
  type AuthorizedDocument,
} from "@hiveforyou/contracts";
import {
  CoordinatedInvestigationLedger,
  fieldMappingRequestLeaksRecordText,
  formatInvestigationCompletionSummary,
  formatInvestigationRejectionSummary,
  INVESTIGATION_AGENT_TOOLS,
  INVESTIGATION_QUESTIONS_PER_WINDOW,
  type InvestigationWindow,
  renderInvestigationWindow,
  selectInvestigationWindows,
} from "@hiveforyou/contracts/investigation";

import { emitStructuredEvent } from "@/server/observability/logger";
import { callStudyAgentTurn, type PlannerDeps } from "@/server/study-preparation/planner-client";

/**
 * Pinned Rebuild investigation loop. One study-agent turn at a time, executed by
 * `CoordinatedInvestigationLedger`. Each turn sees one catalog window, not the whole pack or corpus.
 * Page text arrives only through `read_pages`. The ledger's proposal is the only model output
 * the investigation engine accepts.
 */

const NUDGE_MESSAGE = "No tool was called. Continue the investigation with the provided tools. Copy written values exactly.";
const CONTINUE_MESSAGE = "Continue the valid investigation work, then call finish_investigation with ready true. Accepted fields do not close the investigation.";

function rejectionHints(ledger: CoordinatedInvestigationLedger): string[] {
  const counts = ledger.lastTurnRejectionCounts;
  const hints: string[] = [];
  if ((counts.unauthorized_evidence ?? 0) > 0) {
    hints.push("A saved extraction quotation did not verify. Leave that fact unmapped and do not propose it again. That is not a citation you can correct.");
  }
  if ((counts.duplicate_fact ?? 0) > 0) {
    hints.push("An extraction fact is already mapped. Reuse its fact id and do not map it again.");
  }
  if ((counts.quote_not_on_page ?? 0) > 0) {
    hints.push("A quote you sent is not on the authorized page. Read the page and quote a contiguous run of words that is already there.");
  }
  if ((counts.invented_value ?? 0) > 0) {
    hints.push("Copy the written value exactly. Do not convert it.");
  }
  if ((counts.invalid_arguments ?? 0) > 0) {
    hints.push("Cite an accepted fact id, or state the uncertainty. Do not say the pages were searched unless search_case or read_pages has already run.");
  }
  return hints;
}

function steer(ledger: CoordinatedInvestigationLedger): string {
  const hints = rejectionHints(ledger);
  const open = ledger.completionFeedback();
  if (open) hints.push(open);
  if (hints.length === 0) hints.push(CONTINUE_MESSAGE);
  return hints.join(" ");
}

function listAll(ids: readonly string[]): string {
  return ids.join(", ");
}

/** Request questions first, then this window's catalog questions. Accepted mappings do not close either list. */
function questionWork(ledger: CoordinatedInvestigationLedger, windowIndex: number): string | null {
  const intent = ledger.pendingIntentQuestionIds();
  const catalog = ledger.pendingWindowQuestionIds(windowIndex);
  if (intent.length === 0 && catalog.length === 0) return null;
  const parts: string[] = [];
  if (intent.length > 0) {
    parts.push(`Answer the request questions first: ${listAll(intent)}.`);
  }
  if (catalog.length > 0) {
    parts.push(`This window's questions are still open: ${listAll(catalog)}. Accepted mappings do not close them.`);
  }
  const facts = ledger.acceptedFactIds();
  if (facts.length > 0) parts.push(`Cite these accepted fact ids when they support the answer: ${listAll(facts)}.`);
  parts.push("When no accepted fact supports the question, state the uncertainty. Do not invent an answer. Do not say the pages were searched unless search_case or read_pages has already run.");
  const hints = rejectionHints(ledger);
  if (hints.length > 0) parts.push(hints.join(" "));
  return parts.join(" ");
}

export type MappingAgentTotals = {
  rounds: number;
  roundsAllowed: number;
  toolCalls: number;
  invalidCalls: number;
  acceptedFields: number;
  windowCount: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  modelAlias: string | null;
  resolvedModel: string | null;
  finishReason: string | null;
};

/**
 * Mapping turns and question turns are both required. The hard ceilings stay where they are.
 * `roundsNeeded` and `callsNeeded` are the uncapped demand; the caller refuses when either exceeds a ceiling.
 */
function investigationDemand(input: { windows: number; pages: number; catalogQuestions: number; intentQuestions: number }) {
  const batch = INVESTIGATION_QUESTIONS_PER_WINDOW;
  const questionTurns = Math.ceil(Math.max(input.catalogQuestions, 0) / batch);
  const intentTurns = Math.ceil(Math.max(input.intentQuestions, 0) / batch);
  const pageTurns = Math.ceil(Math.max(input.pages, 0) / 3);
  const mappingTurns = Math.max(input.windows, 0);
  const headroom = 2;
  const roundsNeeded = Math.max(
    4,
    mappingTurns + questionTurns + intentTurns + headroom,
    pageTurns + questionTurns + intentTurns + headroom,
  );
  const callsNeeded = Math.max(input.catalogQuestions, 0)
    + Math.max(input.intentQuestions, 0)
    + pageTurns
    + Math.max(input.windows, 1)
    + 1;
  return { roundsNeeded, callsNeeded, questionTurns, intentTurns };
}

function questionIdsOf(rendered: Record<string, unknown>): string[] {
  if (!Array.isArray(rendered.questions)) return [];
  return rendered.questions.flatMap((item) => {
    if (!item || typeof item !== "object" || !("id" in item)) return [];
    const id = (item as { id?: unknown }).id;
    return typeof id === "string" && id.trim() !== "" ? [id] : [];
  });
}

export async function runDomainMappingInvestigation(input: {
  planner: PlannerDeps;
  runId: string;
  hiveId: string;
  correlationId: string;
  prompt: { readonly id: string; readonly digest: string; readonly systemPrompt: string };
  plan: Pick<DomainInvestigationPlan, "tasks">;
  pack: CompiledDomainPack;
  extractions: readonly DocExtraction[];
  pages: readonly AuthorizedDocument[];
  intentText?: string;
  deadline?: number;
  clock?: () => number;
}): Promise<
  | { ok: true; proposal: NonNullable<ReturnType<CoordinatedInvestigationLedger["assemble"]>>["proposal"]; record: NonNullable<ReturnType<CoordinatedInvestigationLedger["assemble"]>>["record"]; totals: MappingAgentTotals }
  | { ok: false; error: HiveError; totals: MappingAgentTotals }
> {
  const clock = input.clock ?? Date.now;
  const startedAt = clock();
  const deadline = input.deadline ?? startedAt + 120_000;
  const windows = selectInvestigationWindows({ plan: input.plan, pack: input.pack, extractions: input.extractions });
  const pageCount = input.pages.reduce((sum, document) => sum + document.pages.length, 0);
  const ledger = new CoordinatedInvestigationLedger(input.runId, input.pack, input.extractions, input.pages, input.intentText ?? "");
  const questionCounts = ledger.scheduledQuestionCounts();
  const demand = investigationDemand({
    windows: windows.length,
    pages: pageCount,
    catalogQuestions: questionCounts.catalog,
    intentQuestions: questionCounts.intent,
  });
  const fits = demand.roundsNeeded <= STUDY_AGENT_BUDGET.maxRounds && demand.callsNeeded <= STUDY_AGENT_BUDGET.maxToolCalls;
  const limits = {
    rounds: fits ? demand.roundsNeeded : STUDY_AGENT_BUDGET.maxRounds,
    toolCalls: Math.min(
      STUDY_AGENT_BUDGET.maxToolCalls,
      (fits ? demand.roundsNeeded : STUDY_AGENT_BUDGET.maxRounds) * STUDY_AGENT_BUDGET.maxCallsPerTurn,
    ),
    invalidCalls: Math.min(
      STUDY_AGENT_BUDGET.maxInvalidCalls,
      Math.max(4, fits ? demand.roundsNeeded : STUDY_AGENT_BUDGET.maxInvalidCalls),
    ),
  };
  const pageTexts = input.pages.flatMap((document) => document.pages.map((page) => ({ text: page.text })));
  let windowIndex = 0;
  let nudged = false;
  let recoveredWindow: number | null = null;
  const totals: MappingAgentTotals = {
    rounds: 0,
    roundsAllowed: limits.rounds,
    toolCalls: 0,
    invalidCalls: 0,
    acceptedFields: 0,
    windowCount: windows.length,
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: 0,
    modelAlias: null,
    resolvedModel: null,
    finishReason: null,
  };
  const sync = () => {
    totals.toolCalls = ledger.toolCalls;
    totals.invalidCalls = ledger.invalidCalls;
    totals.acceptedFields = ledger.acceptedFieldCount;
  };
  const fail = (
    diagnosticReason: string,
    dimension?: StudyAgentBudgetDimension,
    progress?: {
      roundsUsed?: number;
      roundsAllowed?: number;
      toolCalls?: number;
      invalidCalls?: number;
      questionsCompleted?: number;
      questionsTotal?: number;
    },
  ): { ok: false; error: HiveError; totals: MappingAgentTotals } => {
    sync();
    const blockers = formatInvestigationCompletionSummary(ledger.completionCounts());
    const diagnosticField = dimension
      ? formatStudyAgentBudgetDiagnosticField({
          dimension,
          roundsUsed: progress?.roundsUsed ?? totals.rounds,
          roundsAllowed: progress?.roundsAllowed ?? totals.roundsAllowed,
          toolCalls: progress?.toolCalls ?? totals.toolCalls,
          invalidCalls: progress?.invalidCalls ?? totals.invalidCalls,
          questionsCompleted: progress?.questionsCompleted ?? totals.acceptedFields,
          questionsTotal: progress?.questionsTotal ?? totals.windowCount,
        })
      : undefined;
    if (diagnosticReason === "investigation_capacity") {
      emitStructuredEvent({
        eventName: "mapping.investigation.incomplete",
        severity: "WARN",
        timestamp: new Date().toISOString(),
        component: "pipeline",
        operation: "canonicalize",
        stage: "ANALYZE",
        task: "investigation",
        correlationId: input.correlationId,
        processingRunId: input.runId,
        durationMs: Math.max(0, Math.trunc(clock() - startedAt)),
        rounds: progress?.roundsUsed ?? totals.rounds,
        diagnosticReason,
        ...(diagnosticField ? { diagnosticField } : {}),
      });
    }
    if (blockers) {
      emitStructuredEvent({
        eventName: "mapping.investigation.incomplete",
        severity: "WARN",
        timestamp: new Date().toISOString(),
        component: "pipeline",
        operation: "canonicalize",
        stage: "ANALYZE",
        task: "investigation",
        correlationId: input.correlationId,
        processingRunId: input.runId,
        durationMs: Math.max(0, Math.trunc(clock() - startedAt)),
        rounds: totals.rounds,
        diagnosticReason: "mapping_incomplete",
        rejectionSummary: blockers,
      });
    }
    return {
      ok: false,
      totals,
      error: createHiveError({
        errorCode: "MODEL_OUTPUT_INVALID",
        category: "MODEL",
        stage: "ANALYZE",
        retryable: false,
        safeMessage: "The study could not be checked against the saved evidence. Your earlier study is unchanged.",
        correlationId: input.correlationId,
        operationId: input.runId,
        diagnosticReason,
        ...(diagnosticField ? { diagnosticField } : {}),
      }),
    };
  };
  const boundary = (payload: unknown) => fieldMappingRequestLeaksRecordText(payload, pageTexts);
  if (!fits) {
    const dimension = demand.roundsNeeded > STUDY_AGENT_BUDGET.maxRounds ? "rounds" : "tool_calls";
    return fail("investigation_capacity", dimension, {
      roundsUsed: demand.roundsNeeded,
      roundsAllowed: STUDY_AGENT_BUDGET.maxRounds,
      toolCalls: demand.callsNeeded,
      invalidCalls: 0,
      questionsCompleted: 0,
      questionsTotal: questionCounts.catalog + questionCounts.intent,
    });
  }
  if (!ledger.armCompletion({
    windowCount: windows.length,
    documentIds: input.pages.map((document) => document.documentId),
  })) return fail("investigation_incomplete");
  const firstWindow = renderInvestigationWindow({ window: windows[0]!, extractions: input.extractions, intentText: input.intentText ?? "" });
  if (boundary(firstWindow)) return fail("investigation_record_text_boundary");
  ledger.presentWindow(windows[0]!.index, { questionIds: questionIdsOf(firstWindow) });
  const messages: StudyAgentMessage[] = [{ role: "user", content: JSON.stringify(firstWindow) }];

  while (!ledger.finished) {
    if (totals.rounds >= limits.rounds) return fail("mapping_agent_budget_exhausted", "rounds");
    if (ledger.toolCalls >= limits.toolCalls) return fail("mapping_agent_budget_exhausted", "tool_calls");
    if (ledger.invalidBudgetUsed >= limits.invalidCalls) return fail("mapping_agent_budget_exhausted", "invalid_calls");
    const outputTokens = Math.min(STUDY_AGENT_BUDGET.turnOutputTokens, STUDY_AGENT_BUDGET.maxOutputTokens - totals.completionTokens);
    if (outputTokens < STUDY_AGENT_BUDGET.minTurnOutputTokens) return fail("mapping_agent_budget_exhausted", "output_tokens");
    const turnMs = Math.min(STUDY_AGENT_BUDGET.maxTurnMs, deadline - clock());
    if (turnMs < STUDY_AGENT_BUDGET.minTurnMs) return fail("mapping_agent_budget_exhausted", "wall_clock");
    const request: Omit<StudyAgentTurnRequest, "contract_version"> = {
      task: "investigation",
      hive_id: input.hiveId,
      prompt_id: input.prompt.id,
      prompt_digest: input.prompt.digest,
      system_prompt: input.prompt.systemPrompt,
      messages,
      tools: INVESTIGATION_AGENT_TOOLS,
      max_output_tokens: outputTokens,
      timeout_seconds: Math.floor((turnMs - STUDY_AGENT_BUDGET.turnAbortMarginMs) / 1000),
    };
    const bytes = Buffer.byteLength(JSON.stringify(request), "utf8");
    if (bytes > STUDY_AGENT_BUDGET.maxRequestBytes) return fail("mapping_agent_budget_exhausted", "request_bytes");
    const estimatedInput = totals.promptTokens + Math.ceil(bytes / 3);
    if (estimatedInput > STUDY_AGENT_BUDGET.maxInputTokens) return fail("mapping_agent_budget_exhausted", "input_tokens");
    if (estimateStudyAgentUsd(estimatedInput, totals.completionTokens + outputTokens) > STUDY_AGENT_BUDGET.maxEstimatedUsd) {
      return fail("mapping_agent_budget_exhausted", "estimated_cost");
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
      if (error && typeof error === "object" && "errorCode" in error) return { ok: false, error: error as HiveError, totals };
      throw error;
    }
    totals.rounds += 1;
    totals.promptTokens += turn.usage.promptTokens ?? Math.ceil(bytes / 3);
    totals.completionTokens += turn.usage.completionTokens ?? outputTokens;
    totals.latencyMs += turn.latencyMs;
    totals.modelAlias = turn.modelAlias;
    totals.resolvedModel = turn.resolvedModel ?? totals.resolvedModel;
    totals.finishReason = turn.finishReason;
    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: turn.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
    });
    if (turn.toolCalls.length === 0) {
      ledger.noteInvalidTurn();
      sync();
      emitRejection(input, ledger, clock, startedAt, totals.rounds);
      if (!nudged) {
        nudged = true;
        messages.push({ role: "user", content: NUDGE_MESSAGE });
        continue;
      }
    } else {
      ledger.beginTurn();
      turn.toolCalls.forEach((call, index) => {
        const result = index >= STUDY_AGENT_BUDGET.maxCallsPerTurn
          ? ledger.decline(call, "too_many_calls", `At most ${STUDY_AGENT_BUDGET.maxCallsPerTurn} tool calls per turn.`)
          : ledger.finished
            ? ledger.decline(call, "mapping_finished", "Investigation is already finished.")
            : ledger.execute(call);
        messages.push({ role: "tool", tool_call_id: result.toolCallId, content: result.content });
      });
      sync();
      emitRejection(input, ledger, clock, startedAt, totals.rounds);
      if (ledger.finished) break;
    }
    const next = nextWindow(windows, windowIndex);
    if (next && ledger.lastTurnNeedsRecovery() && recoveredWindow !== windowIndex) {
      recoveredWindow = windowIndex;
      messages.push({ role: "user", content: steer(ledger) });
      continue;
    }
    const work = questionWork(ledger, windowIndex);
    if (work) {
      if (boundary(work)) return fail("investigation_record_text_boundary");
      messages.push({ role: "user", content: work });
      continue;
    }
    if (next) {
      const rendered = renderInvestigationWindow({ window: next, extractions: input.extractions, intentText: input.intentText ?? "" });
      if (boundary(rendered)) return fail("investigation_record_text_boundary");
      ledger.presentWindow(next.index, { questionIds: questionIdsOf(rendered) });
      windowIndex = next.index;
      recoveredWindow = null;
      nudged = false;
      messages.push({ role: "user", content: JSON.stringify(rendered) });
      continue;
    }
    messages.push({ role: "user", content: steer(ledger) });
  }
  sync();
  const assembled = ledger.assemble();
  if (!assembled) return fail("mapping_incomplete");
  return { ok: true, proposal: assembled.proposal, record: assembled.record, totals };
}

function nextWindow(windows: readonly InvestigationWindow[], windowIndex: number): InvestigationWindow | null {
  return windows[windowIndex + 1] ?? null;
}

function emitRejection(
  input: { correlationId: string; runId: string },
  ledger: CoordinatedInvestigationLedger,
  clock: () => number,
  startedAt: number,
  rounds: number,
): void {
  const summary = formatInvestigationRejectionSummary(ledger.lastTurnRejectionCounts);
  if (!summary) return;
  emitStructuredEvent({
    eventName: "mapping.turn.rejected",
    severity: "WARN",
    timestamp: new Date().toISOString(),
    component: "pipeline",
    operation: "canonicalize",
    stage: "ANALYZE",
    task: "investigation",
    correlationId: input.correlationId,
    processingRunId: input.runId,
    durationMs: Math.max(0, Math.trunc(clock() - startedAt)),
    rounds,
    diagnosticReason: summary.split(",")[0]?.split(":")[0] ?? "model_output_invalid",
    rejectionSummary: summary,
  });
}
