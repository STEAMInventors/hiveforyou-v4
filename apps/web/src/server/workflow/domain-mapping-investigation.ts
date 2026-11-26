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
  formatInvestigationRejectionSummary,
  INVESTIGATION_AGENT_TOOLS,
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
const FINISH_NUDGE = "Phase F is still open. Call finish_investigation with ready true only after every manifest document has an evidence-backed role, every shown question has an answer or uncertainty, and every non-empty anchor page has been read. Accepted fields do not close the investigation. The call only asks Hive to stop.";

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

function allowance(input: { windows: number; pages: number; questions: number }) {
  const pageTurns = Math.ceil(Math.max(input.pages, 0) / 3);
  const questionTurns = Math.ceil(Math.max(input.questions, 0) / 8);
  const rounds = Math.min(
    STUDY_AGENT_BUDGET.maxRounds,
    Math.max(4, input.windows + 2, pageTurns, questionTurns),
  );
  return {
    rounds,
    toolCalls: Math.min(STUDY_AGENT_BUDGET.maxToolCalls, rounds * STUDY_AGENT_BUDGET.maxCallsPerTurn),
    invalidCalls: Math.min(STUDY_AGENT_BUDGET.maxInvalidCalls, Math.max(4, input.windows)),
  };
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
  const questionCount = input.pack.definitions.filter((definition) => definition.kind === "question").length;
  const limits = allowance({ windows: windows.length, pages: pageCount, questions: questionCount });
  const ledger = new CoordinatedInvestigationLedger(input.runId, input.pack, input.extractions, input.pages, input.intentText ?? "");
  const pageTexts = input.pages.flatMap((document) => document.pages.map((page) => ({ text: page.text })));
  let windowIndex = 0;
  let nudged = false;
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
  const fail = (diagnosticReason: string, dimension?: StudyAgentBudgetDimension): { ok: false; error: HiveError; totals: MappingAgentTotals } => {
    sync();
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
        ...(dimension
          ? {
              diagnosticField: formatStudyAgentBudgetDiagnosticField({
                dimension,
                roundsUsed: totals.rounds,
                roundsAllowed: totals.roundsAllowed,
                toolCalls: totals.toolCalls,
                invalidCalls: totals.invalidCalls,
                questionsCompleted: totals.acceptedFields,
                questionsTotal: totals.windowCount,
              }),
            }
          : {}),
      }),
    };
  };
  const boundary = (payload: unknown) => fieldMappingRequestLeaksRecordText(payload, pageTexts);
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
    if (next) {
      const rendered = renderInvestigationWindow({ window: next, extractions: input.extractions, intentText: input.intentText ?? "" });
      if (boundary(rendered)) return fail("investigation_record_text_boundary");
      ledger.presentWindow(next.index, { questionIds: questionIdsOf(rendered) });
      windowIndex = next.index;
      nudged = false;
      messages.push({ role: "user", content: JSON.stringify(rendered) });
      continue;
    }
    if (!nudged) {
      nudged = true;
      messages.push({ role: "user", content: FINISH_NUDGE });
      continue;
    }
    return fail("mapping_incomplete");
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
