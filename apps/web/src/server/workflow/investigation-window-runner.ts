/**
 * Fair, per-window investigation.
 * Each window gets its own share of the study budget and its own prompt.
 * A paused window is resumed later. Completed windows are not sent again.
 * The ledger verifies every tool call. This runner does not accept a Study.
 */
import {
  createHiveError,
  estimateStudyAgentUsd,
  STUDY_AGENT_BUDGET,
  type HiveError,
  type StudyAgentMessage,
  type StudyAgentTurnRequest,
  type CompiledDomainPack,
  type DocExtraction,
  type DomainInvestigationPlan,
  type AuthorizedDocument,
} from "@hiveforyou/contracts";
import {
  CoordinatedInvestigationLedger,
  INVESTIGATION_AGENT_TOOLS,
  INVESTIGATION_AGENT_TOOL_NAMES,
  blockInvestigationWindow,
  completeInvestigationWindow,
  pauseInvestigationWindow,
  intentQuestionIds,
  investigationWindowsRemain,
  planInvestigationWindows,
  presentDocumentKindIds,
  priorAcceptedFactIds,
  recordWindowTurn,
  resumeWindowProgress,
  selectNextInvestigationWindow,
  startWindowProgress,
  type InvestigationWindowProgress,
  type PlannedInvestigationWindow,
} from "@hiveforyou/contracts/investigation";
import { computeSha256Digest } from "@hiveforyou/contracts/document-read";
import {
  compileInvestigationPrompt,
  resolveSyntheticExecutionFixtureId,
  type CaseInvestigationSpecification,
  type EffectiveDomainPack,
} from "@hiveforyou/contracts/study-engine";

import { emitStructuredEvent } from "@/server/observability/logger";
import { callStudyAgentTurn, type PlannerDeps } from "@/server/study-preparation/planner-client";

const NUDGE = "No tool was called. Use the tools. Copy written values exactly. Do not state a legal conclusion or a calculation result.";

export type InvestigationWindowRunResult =
  | {
      ok: true;
      progress: InvestigationWindowProgress;
      proposal: NonNullable<ReturnType<CoordinatedInvestigationLedger["assemble"]>>["proposal"];
      record: NonNullable<ReturnType<CoordinatedInvestigationLedger["assemble"]>>["record"];
    }
  | { ok: false; progress: InvestigationWindowProgress; error: HiveError; resumable: boolean };

function labelsOf(extraction: DocExtraction): string[] {
  return [extraction.fileName, extraction.document.documentType, extraction.document.titleAsPrinted, extraction.document.summary]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "");
}

function sourceIdsFor(extractions: readonly DocExtraction[], definitions: CompiledDomainPack["definitions"], kindIds: readonly string[]): string[] {
  const wanted = new Set(kindIds);
  const ids: string[] = [];
  for (const extraction of extractions) {
    const matched = presentDocumentKindIds(definitions, labelsOf(extraction));
    if (matched.some((id) => wanted.has(id))) ids.push(extraction.documentId);
  }
  return [...new Set(ids)].sort();
}

function requiredQuestions(planWindows: readonly PlannedInvestigationWindow[], window: PlannedInvestigationWindow, intent: string): string[] {
  const first = planWindows.find((item) => item.executable);
  const intentIds = first?.windowId === window.windowId ? intentQuestionIds(intent) : [];
  return [...new Set([...window.questionIds, ...intentIds])];
}

function userPayload(window: PlannedInvestigationWindow, questions: readonly string[], prior: readonly string[], promptText: string, lastOpen: boolean): string {
  return [
    "WINDOW " + window.windowId,
    "QUESTIONS " + questions.join(" "),
    "MISSING " + window.missingDocumentIds.join(" "),
    "PRIOR " + prior.join(" "),
    "Investigate only this window. A missing record on an applicable objective stays missing. Do not treat it as inapplicable and do not invent it.",
    "An objective that does not apply is not a request to obtain a document.",
    "Search and read before quoting. Cite an accepted fact id, or state uncertainty. Quote only words that are already on an authorized page.",
    "Do not create an accepted fact, a calculation result, a legal conclusion, or a Canonical Study.",
    lastOpen ? "This is the last open window. After its questions are answered, call finish_investigation with ready true. If that call is refused, do the remaining checks it names. Do not invent a role, a finding, or an answer." : "",
    promptText,
  ].join("\n");
}

function budgetRemaining(progress: InvestigationWindowProgress): boolean {
  const rounds = progress.windows.reduce((sum, window) => sum + window.roundsUsed, 0);
  const calls = progress.windows.reduce((sum, window) => sum + window.toolCallsUsed, 0);
  return rounds < STUDY_AGENT_BUDGET.maxRounds - 1 && calls < STUDY_AGENT_BUDGET.maxToolCalls - 1;
}

function sameSubmission(left: { id: string; name: string; arguments: string }, right: { id: string; name: string; arguments: string }): boolean {
  return left.name === right.name && left.arguments === right.arguments && (left.id === right.id || left.arguments !== "");
}

const DIAGNOSTIC_FIELD = /^[A-Za-z][A-Za-z0-9_.:/\[\]@+-]{0,127}$/;
const REASON = /^[a-z][a-z0-9_]{0,63}$/;

function windowDiagnostic(
  pack: { identity: { packId: string; version: string } },
  progress: InvestigationWindowProgress,
  code: string,
): { field: string; sentence: string } {
  const counted = progress.windows.filter((window) => window.executable);
  const rows = counted.length > 0 ? counted : [...progress.windows];
  const done = rows.filter((window) => window.status === "complete" || window.status === "settled").length;
  const current = rows.find((window) => window.status === "running" || window.status === "paused" || window.status === "blocked");
  const sentence = `Study pack ${pack.identity.packId} ${pack.identity.version}, stage CANONICALIZING, ${done} of ${rows.length} windows complete${current ? `, ${current.windowId} is ${current.status}` : ""}. Reason: ${code}.`;
  const field = `pack@${pack.identity.packId}/${pack.identity.version}/stage@CANONICALIZING/windows@${done}/${rows.length}/code@${code}`;
  return { field: DIAGNOSTIC_FIELD.test(field) ? field : `code@${code}`, sentence };
}

function failure(input: {
  correlationId: string;
  runId: string;
  code: string;
  resumable: boolean;
  safeMessage: string;
  diagnosticField?: string;
}): HiveError {
  const field = input.diagnosticField && DIAGNOSTIC_FIELD.test(input.diagnosticField) ? input.diagnosticField : input.code;
  return createHiveError({
    errorCode: input.resumable ? "MODEL_TIMEOUT" : "MODEL_OUTPUT_INVALID",
    category: input.resumable ? "DEPENDENCY" : "MODEL",
    stage: "ANALYZE",
    retryable: input.resumable,
    safeMessage: input.safeMessage.slice(0, 280),
    correlationId: input.correlationId,
    operationId: input.runId,
    diagnosticReason: REASON.test(input.code) ? input.code : "investigation_incomplete",
    diagnosticField: DIAGNOSTIC_FIELD.test(field) ? field : "investigation_incomplete",
  });
}

export async function runInvestigationWindows(input: {
  planner: PlannerDeps;
  prompt: { readonly id: string; readonly digest: string; readonly systemPrompt: string };
  runId: string;
  hiveId: string;
  correlationId: string;
  intent: string;
  pack: CompiledDomainPack;
  effective: EffectiveDomainPack;
  specification: CaseInvestigationSpecification;
  evidence: unknown;
  plan: DomainInvestigationPlan;
  extractions: readonly DocExtraction[];
  pages: readonly AuthorizedDocument[];
  authorizedPages: readonly { documentId: string; pageNumber: number; sourcePageDigest: string }[];
  saved?: InvestigationWindowProgress | null;
  deadline?: number;
  clock?: () => number;
  onProgress?: (progress: InvestigationWindowProgress) => Promise<void>;
  callTurn?: typeof callStudyAgentTurn;
}): Promise<InvestigationWindowRunResult> {
  const clock = input.clock ?? Date.now;
  const startedAt = clock();
  const deadline = input.deadline ?? startedAt + STUDY_AGENT_BUDGET.wallClockMs;
  const fixturePages = input.pages.flatMap((document) => document.pages.map((page) => ({
    documentId: document.documentId,
    pageNumber: page.pageNumber,
    text: page.text,
    sourcePageDigest: computeSha256Digest(page.text),
  })));
  if (!resolveSyntheticExecutionFixtureId({ hiveId: input.hiveId, pages: fixturePages })) {
    const progress = startWindowProgress(planInvestigationWindows({
      intent: input.intent,
      plan: input.plan,
      presentDocumentIds: [],
    }));
    const detail = windowDiagnostic(input.pack, progress, "privacy_denied");
    return {
      ok: false,
      progress,
      resumable: false,
      error: failure({
        correlationId: input.correlationId,
        runId: input.runId,
        code: "privacy_denied",
        resumable: false,
        safeMessage: `${detail.sentence} This case cannot be sent to the model. Your earlier study is unchanged.`,
        diagnosticField: detail.field,
      }),
    };
  }
  const present = presentDocumentKindIds(input.pack.definitions, input.extractions.flatMap(labelsOf));
  const planned = planInvestigationWindows({
    intent: input.intent,
    plan: input.plan,
    presentDocumentIds: present,
  });
  let progress = resumeWindowProgress(planned, input.saved);
  const publish = async () => {
    if (input.onProgress) await input.onProgress(progress);
  };
  const stop = (code: string, resumable: boolean, safeMessage: string): InvestigationWindowRunResult => {
    const detail = windowDiagnostic(input.pack, progress, code);
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
      rounds: progress.windows.reduce((sum, window) => sum + window.roundsUsed, 0),
      diagnosticReason: code,
      diagnosticField: detail.field,
      errorDetail: `windows=${progress.windows.length};complete=${progress.windows.filter((window) => window.status === "complete" || window.status === "settled").length};${detail.field}`,
    });
    return {
      ok: false,
      progress,
      resumable,
      error: failure({
        correlationId: input.correlationId,
        runId: input.runId,
        code,
        resumable,
        safeMessage: `${detail.sentence} ${safeMessage}`,
        diagnosticField: detail.field,
      }),
    };
  };
  if (planned.dependencyCycle) {
    return stop("investigation_incomplete", false, "The investigation could not be scheduled. Your earlier study is unchanged.");
  }
  const executable = planned.windows.filter((window) => window.executable);
  const indexOf = new Map(executable.map((window, index) => [window.windowId, index]));
  const ledger = new CoordinatedInvestigationLedger(input.runId, input.pack, input.extractions, input.pages, input.intent);
  if (executable.length > 0 && !ledger.armCompletion({
    windowCount: executable.length,
    documentIds: input.pages.map((document) => document.documentId),
  })) {
    return stop("investigation_incomplete", false, "The investigation could not be scheduled. Your earlier study is unchanged.");
  }
  for (const window of executable) {
    const state = progress.windows.find((item) => item.windowId === window.windowId);
    const index = indexOf.get(window.windowId);
    if (!state || index === undefined || state.replay.length === 0) continue;
    ledger.presentWindow(index, { questionIds: requiredQuestions(planned.windows, window, input.intent) });
    for (const call of state.replay) ledger.execute(call);
  }
  await publish();
  const transcripts = new Map<string, StudyAgentMessage[]>();

  while (true) {
    const window = selectNextInvestigationWindow(planned, progress);
    if (!window) break;
    const index = indexOf.get(window.windowId);
    const state = progress.windows.find((item) => item.windowId === window.windowId);
    if (index === undefined || !state) break;
    const questions = requiredQuestions(planned.windows, window, input.intent);
    ledger.presentWindow(index, { questionIds: questions });
    const pending = questions.filter((id) => ledger.pendingWindowQuestionIds(index).includes(id) || (id.startsWith("intent:") && ledger.pendingIntentQuestionIds().includes(id)));
    const othersOpen = executable.some((item) => {
      if (item.windowId === window.windowId) return false;
      const itemState = progress.windows.find((row) => row.windowId === item.windowId);
      return !!itemState && itemState.status !== "complete" && itemState.status !== "settled" && itemState.status !== "blocked";
    });
    const questionsSettled = pending.length === 0 && (questions.length > 0 || state.modelTurns > 0);
    if (questionsSettled && (othersOpen || ledger.finished)) {
      progress = completeInvestigationWindow(progress, window.windowId, {
        factIds: ledger.acceptedFactIds(),
        questionIds: questions,
      });
      await publish();
      continue;
    }
    const kindIds = [...new Set(window.obligations.flatMap((item) => item.documentIds))];
    const scoped = window.definitionIds.length + window.questionIds.length > 0;
    const compiled = scoped ? compileInvestigationPrompt({
      pack: input.effective,
      specification: input.specification,
      evidence: input.evidence,
      intent: input.intent,
      disclosure: { decision: "WITHHELD" },
      factValues: [],
      authorizedPages: input.authorizedPages,
      windowScope: {
        definitionIds: window.definitionIds,
        questionIds: window.questionIds,
        priorFindingIds: priorAcceptedFactIds(progress, window.windowId).filter((id) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)),
        toolNames: [...INVESTIGATION_AGENT_TOOL_NAMES],
        missingDocumentIds: window.missingDocumentIds,
        evidenceDocumentIds: sourceIdsFor(input.extractions, input.pack.definitions, kindIds),
      },
    }) : null;
    if (compiled && !compiled.ok) {
      progress = blockInvestigationWindow(progress, window.windowId);
      await publish();
      continue;
    }
    const outputTokens = Math.min(STUDY_AGENT_BUDGET.turnOutputTokens, STUDY_AGENT_BUDGET.maxOutputTokens - state.outputTokens);
    const turnMs = Math.min(STUDY_AGENT_BUDGET.maxTurnMs, deadline - clock());
    if (outputTokens < STUDY_AGENT_BUDGET.minTurnOutputTokens || turnMs < STUDY_AGENT_BUDGET.minTurnMs) break;
    const promptText = compiled && compiled.ok
      ? compiled.value.sections.map((section) => section.text).join("\n\n")
      : "No pack clause is in this window. State uncertainty. Do not invent evidence.";
    const lastOpen = executable.every((item) => {
      if (item.windowId === window.windowId) return true;
      const itemState = progress.windows.find((row) => row.windowId === item.windowId);
      return itemState?.status === "complete" || itemState?.status === "settled" || itemState?.status === "blocked";
    });
    const content = userPayload(window, pending.length > 0 ? pending : questions, priorAcceptedFactIds(progress, window.windowId), promptText, lastOpen);
    let messages = transcripts.get(window.windowId);
    if (!messages || messages.length === 0) {
      const seeded: StudyAgentMessage[] = [{ role: "user", content }];
      if (state.replay.length > 0) {
        seeded.push({
          role: "assistant",
          content: null,
          tool_calls: state.replay.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
        });
        for (const call of state.replay) {
          const result = ledger.execute(call);
          seeded.push({ role: "tool", tool_call_id: result.toolCallId, content: result.content });
        }
      }
      messages = seeded;
      transcripts.set(window.windowId, messages);
    }
    if (lastOpen && !messages.some((message) => message.role === "user" && message.content.includes("last open window"))) {
      messages = [...messages, {
        role: "user",
        content: "This is the last open window. Call finish_investigation with ready true after the remaining checks. Do not invent a role, a finding, or an answer.",
      }];
      transcripts.set(window.windowId, messages);
    }
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
    const estimatedInput = state.inputTokens + Math.ceil(bytes / 3);
    const windowUsd = estimateStudyAgentUsd(estimatedInput, state.outputTokens + outputTokens);
    const globalInput = progress.windows.reduce((sum, item) => sum + item.inputTokens, 0) + Math.ceil(bytes / 3);
    const globalOutput = progress.windows.reduce((sum, item) => sum + item.outputTokens, 0) + outputTokens;
    if (bytes > STUDY_AGENT_BUDGET.maxRequestBytes || windowUsd * 100 > state.budgetUsdCents) {
      progress = pauseInvestigationWindow(progress, window.windowId);
      await publish();
      continue;
    }
    if (estimateStudyAgentUsd(globalInput, globalOutput) > STUDY_AGENT_BUDGET.maxEstimatedUsd) break;
    let turn: Awaited<ReturnType<typeof callStudyAgentTurn>>;
    try {
      turn = await (input.callTurn ?? callStudyAgentTurn)(input.planner, {
        request,
        abortMs: turnMs,
        correlationId: input.correlationId,
        processingRunId: input.runId,
      });
    } catch (error) {
      await publish();
      if (error && typeof error === "object" && "errorCode" in error) {
        const hive = error as HiveError;
        const code = hive.diagnosticReason && REASON.test(hive.diagnosticReason) ? hive.diagnosticReason : "planner_unavailable";
        const detail = windowDiagnostic(input.pack, progress, code);
        return {
          ok: false,
          progress,
          resumable: true,
          error: createHiveError({
            errorCode: hive.errorCode,
            category: hive.category,
            stage: hive.stage,
            retryable: true,
            safeMessage: `${detail.sentence} ${hive.safeMessage}`.slice(0, 280),
            correlationId: hive.correlationId,
            operationId: hive.operationId ?? input.runId,
            diagnosticReason: code,
            diagnosticField: detail.field,
          }),
        };
      }
      throw error;
    }
    const calls = turn.toolCalls;
    if (calls.length === 0) {
      progress = recordWindowTurn(progress, window.windowId, {
        inputTokens: turn.usage.promptTokens ?? Math.ceil(bytes / 3),
        outputTokens: turn.usage.completionTokens ?? 0,
        toolCalls: 0,
        invalidCalls: 1,
        calls: [],
      });
      transcripts.set(window.windowId, [...messages, { role: "user", content: NUDGE }]);
      await publish();
      continue;
    }
    ledger.beginTurn();
    const accepted = [...state.replay];
    const replay = [];
    const transcript: StudyAgentMessage[] = [
      ...messages,
      {
        role: "assistant",
        content: turn.content,
        tool_calls: calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
      },
    ];
    for (const [offset, call] of calls.entries()) {
      const prior = accepted.find((item) => sameSubmission(item, call));
      const priorResult = prior ? ledger.execute(prior) : null;
      const priorOk = priorResult ? (JSON.parse(priorResult.content) as { ok?: boolean }).ok === true : false;
      const duplicate = priorResult !== null && (priorOk || prior?.id === call.id);
      const result = duplicate && priorResult
        ? priorResult
        : offset >= STUDY_AGENT_BUDGET.maxCallsPerTurn
          ? ledger.decline(call, "too_many_calls", "Too many tool calls for one turn.")
          : ledger.execute(call);
      if (!duplicate) {
        const stored = { id: call.id, name: call.name, arguments: call.arguments };
        replay.push(stored);
        accepted.push(stored);
      }
      transcript.push({ role: "tool", tool_call_id: call.id, content: result.content });
    }
    transcripts.set(window.windowId, transcript);
    progress = recordWindowTurn(progress, window.windowId, {
      inputTokens: turn.usage.promptTokens ?? Math.ceil(bytes / 3),
      outputTokens: turn.usage.completionTokens ?? 0,
      toolCalls: replay.length,
      invalidCalls: Object.values(ledger.lastTurnRejectionCounts).reduce((sum, count) => sum + count, 0),
      calls: replay,
    });
    const stillOpen = questions.filter((id) => ledger.pendingWindowQuestionIds(index).includes(id) || (id.startsWith("intent:") && ledger.pendingIntentQuestionIds().includes(id)));
    const stillOthers = executable.some((item) => {
      if (item.windowId === window.windowId) return false;
      const itemState = progress.windows.find((row) => row.windowId === item.windowId);
      return !!itemState && itemState.status !== "complete" && itemState.status !== "settled" && itemState.status !== "blocked";
    });
    if (stillOpen.length === 0 && (stillOthers || ledger.finished)) {
      progress = completeInvestigationWindow(progress, window.windowId, {
        factIds: ledger.acceptedFactIds(),
        questionIds: questions,
      });
    }
    await publish();
  }

  const assembled = executable.length > 0 && executable.every((window) => progress.windows.find((item) => item.windowId === window.windowId)?.status === "complete")
    ? ledger.assemble()
    : null;
  if (assembled) return { ok: true, progress, proposal: assembled.proposal, record: assembled.record };
  const resumable = investigationWindowsRemain(planned, progress) && budgetRemaining(progress);
  return stop(
    resumable ? "investigation_window_paused" : "investigation_incomplete",
    resumable,
    resumable
      ? "The analysis is still running. It will continue on the next step. Your earlier study is unchanged."
      : "The study did not pass validation, so it was not accepted. Your earlier study is unchanged.",
  );
}
