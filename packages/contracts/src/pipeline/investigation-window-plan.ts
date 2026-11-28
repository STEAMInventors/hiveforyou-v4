/**
 * Bounded investigation windows for one case.
 * Obligations come from the investigation plan. A missing record stays on the window.
 * This module does not call a model, accept a fact, or publish a Study.
 */
import { STUDY_AGENT_BUDGET } from "../analysis/study-agent";
import { packDigest } from "./domain-pack-compiler";
import type { PackPredicate } from "./domain-pack-source";
import {
  type DomainInvestigationPlan,
  type InvestigationObligation,
} from "./domain-investigation-plan";

export const INVESTIGATION_WINDOW_PLAN_SCHEMA = "hive.investigation-window-plan/1" as const;
export const INVESTIGATION_WINDOW_PROGRESS_SCHEMA = "hive.investigation-window-progress/1" as const;

export const WINDOW_OBJECTIVE_DISPOSITIONS = [
  "NOT_APPLICABLE",
  "EVIDENCE_MISSING",
  "REVIEW_REQUIRED",
  "INVESTIGATION_REQUIRED",
] as const;
export type WindowObjectiveDisposition = (typeof WINDOW_OBJECTIVE_DISPOSITIONS)[number];

export const WINDOW_PROGRESS_STATUSES = ["pending", "running", "complete", "paused", "settled", "blocked"] as const;
export type WindowProgressStatus = (typeof WINDOW_PROGRESS_STATUSES)[number];

const QUESTION_CAP = 8;
const DEFINITION_CAP = 24;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Whether the objective's own condition is met. Document absence here is not a missing-evidence demand. */
type Applicability = "APPLICABLE" | "REVIEW" | "NOT_APPLICABLE" | "UNRESOLVED";

export type PlannedWindowObligation = {
  obligationId: string;
  objectiveId: string;
  audience: "customer" | "professional";
  role: InvestigationObligation["role"];
  disposition: WindowObjectiveDisposition;
  missingDocumentIds: readonly string[];
  documentIds: readonly string[];
  /** Clauses the model may see. Empty when the objective is not sent. */
  questionIds: readonly string[];
  definitionIds: readonly string[];
};

export type PlannedInvestigationWindow = {
  windowId: string;
  sourceWindow: string;
  executable: boolean;
  obligations: readonly PlannedWindowObligation[];
  questionIds: readonly string[];
  definitionIds: readonly string[];
  missingDocumentIds: readonly string[];
  dependsOnWindowIds: readonly string[];
  evidenceRecordDigests: readonly string[];
  budget: { rounds: number; toolCalls: number; invalidCalls: number; estimatedUsdCents: number } | null;
};

export type InvestigationWindowPlan = {
  schema: typeof INVESTIGATION_WINDOW_PLAN_SCHEMA;
  planDigest: string;
  intentDigest: string;
  dependencyCycle: boolean;
  windows: readonly PlannedInvestigationWindow[];
};

export type WindowToolReplay = { id: string; name: string; arguments: string };

export type InvestigationWindowState = {
  windowId: string;
  status: WindowProgressStatus;
  executable: boolean;
  roundsUsed: number;
  toolCallsUsed: number;
  invalidCallsUsed: number;
  inputTokens: number;
  outputTokens: number;
  modelTurns: number;
  budgetRounds: number;
  budgetToolCalls: number;
  budgetInvalidCalls: number;
  budgetUsdCents: number;
  acceptedFactIds: readonly string[];
  answeredQuestionIds: readonly string[];
  unresolvedObligationIds: readonly string[];
  missingDocumentIds: readonly string[];
  replay: readonly WindowToolReplay[];
};

export type InvestigationWindowProgress = {
  schema: typeof INVESTIGATION_WINDOW_PROGRESS_SCHEMA;
  planDigest: string;
  intentDigest: string;
  windows: readonly InvestigationWindowState[];
};

export type VerifiedWindowEvidence = { recordDigest: string; documentKindId: string };

type Classified = {
  obligation: InvestigationObligation;
  disposition: WindowObjectiveDisposition;
  missingDocumentIds: string[];
  questionIds: string[];
  definitionIds: string[];
};

function classifyApplicability(predicate: PackPredicate, present: ReadonlySet<string>): Applicability {
  switch (predicate.op) {
    case "REVIEW_REQUIRED":
      return "REVIEW";
    case "DOCUMENT_PRESENT":
      return present.has(predicate.documentKindId) ? "APPLICABLE" : "NOT_APPLICABLE";
    case "FIELD_PRESENT":
    case "COMPARE":
      return "UNRESOLVED";
    case "NOT": {
      const inner = classifyApplicability(predicate.condition, present);
      if (inner === "APPLICABLE") return "NOT_APPLICABLE";
      if (inner === "NOT_APPLICABLE") return "APPLICABLE";
      return "UNRESOLVED";
    }
    case "ANY":
      return combineAny(predicate.conditions.map((condition) => classifyApplicability(condition, present)));
    case "ALL":
      return combineAll(predicate.conditions.map((condition) => classifyApplicability(condition, present)));
    default:
      return "UNRESOLVED";
  }
}

function combineAny(results: readonly Applicability[]): Applicability {
  if (results.includes("APPLICABLE")) return "APPLICABLE";
  if (results.includes("REVIEW")) return "REVIEW";
  if (results.includes("UNRESOLVED")) return "UNRESOLVED";
  if (results.length > 0 && results.every((result) => result === "NOT_APPLICABLE")) return "NOT_APPLICABLE";
  return "UNRESOLVED";
}

function combineAll(results: readonly Applicability[]): Applicability {
  if (results.includes("NOT_APPLICABLE")) return "NOT_APPLICABLE";
  if (results.includes("UNRESOLVED")) return "UNRESOLVED";
  if (results.includes("REVIEW")) return "REVIEW";
  if (results.length > 0 && results.every((result) => result === "APPLICABLE")) return "APPLICABLE";
  return "UNRESOLVED";
}

function documentKindIds(predicate: PackPredicate): string[] {
  const ids: string[] = [];
  const walk = (node: PackPredicate) => {
    if (node.op === "DOCUMENT_PRESENT") {
      ids.push(node.documentKindId);
      return;
    }
    if (node.op === "NOT") {
      walk(node.condition);
      return;
    }
    if (node.op === "ANY" || node.op === "ALL") {
      for (const condition of node.conditions) walk(condition);
    }
  };
  walk(predicate);
  return ids;
}

function classify(obligation: InvestigationObligation, present: ReadonlySet<string>): Classified {
  const applicability = classifyApplicability(obligation.appliesWhen, present);
  if (applicability === "NOT_APPLICABLE") {
    return { obligation, disposition: "NOT_APPLICABLE", missingDocumentIds: [], questionIds: [], definitionIds: [] };
  }
  const excluded = new Set<string>();
  const kept = new Set<string>();
  const gated = new Set<string>();
  for (const branch of obligation.branches) {
    const branchApplicability = classifyApplicability(branch.appliesWhen, present);
    const closed = branchApplicability === "NOT_APPLICABLE";
    const target = closed ? excluded : kept;
    for (const id of branch.definitionIds) target.add(id);
    if (closed) for (const id of documentKindIds(branch.appliesWhen)) gated.add(id);
  }
  const definitionIds = obligation.definitionIds.filter((id) => !excluded.has(id) || kept.has(id));
  const missingDocumentIds = [...new Set(obligation.documentIds.filter((id) => !present.has(id) && !gated.has(id)))].sort();
  const presentEvidence = obligation.documentIds.filter((id) => present.has(id) && !gated.has(id));
  const blocked = obligation.documentIds.length > 0 && presentEvidence.length === 0 && missingDocumentIds.length > 0;
  if (blocked) {
    return { obligation, disposition: "EVIDENCE_MISSING", missingDocumentIds, questionIds: [], definitionIds: [] };
  }
  return {
    obligation,
    disposition: applicability === "REVIEW" ? "REVIEW_REQUIRED" : "INVESTIGATION_REQUIRED",
    missingDocumentIds,
    questionIds: [...obligation.questionIds],
    definitionIds,
  };
}

function executableDisposition(disposition: WindowObjectiveDisposition): boolean {
  return disposition === "INVESTIGATION_REQUIRED" || disposition === "REVIEW_REQUIRED";
}

/** Equal shares of the investigation ceilings. One window's share is always below the ceiling. */
export function allocateWindowBudgets(count: number): { rounds: number; toolCalls: number; invalidCalls: number; estimatedUsdCents: number } {
  const windows = Math.max(1, Math.floor(count));
  const roundsPool = STUDY_AGENT_BUDGET.maxRounds - 1;
  const callsPool = STUDY_AGENT_BUDGET.maxToolCalls - 1;
  const invalidPool = Math.max(1, STUDY_AGENT_BUDGET.maxInvalidCalls - 1);
  const usdPool = Math.max(1, Math.round(STUDY_AGENT_BUDGET.maxEstimatedUsd * 100) - 1);
  return {
    rounds: Math.max(1, Math.floor(roundsPool / windows)),
    toolCalls: Math.max(1, Math.floor(callsPool / windows)),
    invalidCalls: Math.max(1, Math.floor(invalidPool / windows)),
    estimatedUsdCents: Math.max(1, Math.floor(usdPool / windows)),
  };
}

function sliceObligations(items: readonly Classified[]): Classified[][] {
  const slices: Classified[][] = [];
  let current: Classified[] = [];
  let questions = 0;
  let definitions = 0;
  for (const item of items) {
    const nextQuestions = questions + item.questionIds.length;
    const nextDefinitions = definitions + item.definitionIds.length;
    const overflow = current.length > 0 && (nextQuestions > QUESTION_CAP || nextDefinitions > DEFINITION_CAP);
    if (overflow) {
      slices.push(current);
      current = [];
      questions = 0;
      definitions = 0;
    }
    current.push(item);
    questions += item.questionIds.length;
    definitions += item.definitionIds.length;
  }
  if (current.length > 0) slices.push(current);
  return slices;
}

function evidenceFor(items: readonly Classified[], evidence: readonly VerifiedWindowEvidence[]): string[] {
  const kinds = new Set(items.flatMap((item) => [...item.obligation.documentIds]));
  return evidence
    .filter((record) => kinds.size === 0 || kinds.has(record.documentKindId))
    .map((record) => record.recordDigest)
    .filter((digest, index, all) => /^[a-f0-9]{64}$/.test(digest) && all.indexOf(digest) === index)
    .sort();
}

function reaches(
  edges: ReadonlyMap<string, readonly string[]>,
  from: string,
  target: string,
): boolean {
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === target) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (edges.get(id) ?? []).some((next) => visit(next));
  };
  return (edges.get(from) ?? []).some((next) => visit(next));
}

/**
 * A summary objective can name a later window that also names the summary.
 * Drop only those cycle edges whose window id sorts before its dependency.
 * Every cycle has one such edge, so the remaining order is a DAG.
 */
function breakSchedulingCycles<T extends { windowId: string; dependsOnWindowIds: readonly string[] }>(
  windows: readonly T[],
): T[] {
  const edges = new Map(windows.map((window) => [window.windowId, window.dependsOnWindowIds]));
  return windows.map((window) => ({
    ...window,
    dependsOnWindowIds: window.dependsOnWindowIds.filter((dependency) => {
      const cyclic = reaches(edges, dependency, window.windowId);
      return !cyclic || window.windowId > dependency;
    }),
  }));
}

function hasCycle(windows: readonly { windowId: string; dependsOnWindowIds: readonly string[] }[]): boolean {
  const pending = new Set(windows.map((window) => window.windowId));
  const edges = new Map(windows.map((window) => [window.windowId, window.dependsOnWindowIds]));
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (!pending.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    pending.delete(id);
    return false;
  };
  return [...windows.map((window) => window.windowId)].some((id) => visit(id));
}

export function planInvestigationWindows(input: {
  intent: string;
  plan: DomainInvestigationPlan;
  presentDocumentIds: readonly string[];
  verifiedEvidence?: readonly VerifiedWindowEvidence[];
}): InvestigationWindowPlan {
  const present = new Set(input.presentDocumentIds.filter((id) => id.trim() !== ""));
  const evidence = input.verifiedEvidence ?? [];
  const classified = input.plan.obligations.map((obligation) => classify(obligation, present));
  const byWindow = new Map<string, Classified[]>();
  for (const item of classified) {
    const rows = byWindow.get(item.obligation.window) ?? [];
    rows.push(item);
    byWindow.set(item.obligation.window, rows);
  }
  const groups = [...byWindow.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  const drafted: Array<Omit<PlannedInvestigationWindow, "dependsOnWindowIds" | "budget"> & { objectiveIds: string[] }> = [];
  for (const [sourceWindow, items] of groups) {
    const ordered = [...items].sort((left, right) => left.obligation.objectiveId.localeCompare(right.obligation.objectiveId));
    const slices = sliceObligations(ordered);
    slices.forEach((slice, index) => {
      const windowId = index === 0 ? sourceWindow : `${sourceWindow}~${index + 1}`;
      const obligations: PlannedWindowObligation[] = slice.map((item) => ({
        obligationId: item.obligation.obligationId,
        objectiveId: item.obligation.objectiveId,
        audience: item.obligation.audience,
        role: item.obligation.role,
        disposition: item.disposition,
        missingDocumentIds: item.missingDocumentIds,
        documentIds: [...item.obligation.documentIds],
        questionIds: item.questionIds,
        definitionIds: item.definitionIds,
      }));
      drafted.push({
        windowId,
        sourceWindow,
        executable: obligations.some((item) => executableDisposition(item.disposition)),
        obligations,
        questionIds: [...new Set(slice.flatMap((item) => item.questionIds))].sort(),
        definitionIds: [...new Set(slice.flatMap((item) => item.definitionIds))].sort(),
        missingDocumentIds: [...new Set(slice.flatMap((item) => item.missingDocumentIds))].sort(),
        evidenceRecordDigests: evidenceFor(slice, evidence),
        objectiveIds: slice.map((item) => item.obligation.objectiveId),
      });
    });
  }
  const objectiveWindow = new Map<string, string>();
  for (const window of drafted) {
    for (const objectiveId of window.objectiveIds) objectiveWindow.set(objectiveId, window.windowId);
  }
  const windows: PlannedInvestigationWindow[] = drafted.map((window) => {
    const depends = new Set<string>();
    const sameSource = drafted.filter((item) => item.sourceWindow === window.sourceWindow);
    const sliceIndex = sameSource.findIndex((item) => item.windowId === window.windowId);
    for (const earlier of sameSource.slice(0, Math.max(0, sliceIndex))) depends.add(earlier.windowId);
    for (const item of classified) {
      if (!window.objectiveIds.includes(item.obligation.objectiveId)) continue;
      for (const dependency of item.obligation.dependsOn) {
        const target = objectiveWindow.get(dependency);
        if (target && target !== window.windowId) depends.add(target);
      }
    }
    return {
      windowId: window.windowId,
      sourceWindow: window.sourceWindow,
      executable: window.executable,
      obligations: window.obligations,
      questionIds: window.questionIds,
      definitionIds: window.definitionIds,
      missingDocumentIds: window.missingDocumentIds,
      dependsOnWindowIds: [...depends].sort(),
      evidenceRecordDigests: window.evidenceRecordDigests,
      budget: null,
    };
  });
  const grant = allocateWindowBudgets(windows.filter((window) => window.executable).length);
  const opened = breakSchedulingCycles(windows);
  const budgeted = opened.map((window) => window.executable ? { ...window, budget: grant } : window);
  return {
    schema: INVESTIGATION_WINDOW_PLAN_SCHEMA,
    planDigest: input.plan.digest,
    intentDigest: packDigest(input.intent),
    dependencyCycle: hasCycle(budgeted),
    windows: budgeted,
  };
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Matches pack document labels and aliases against caller-supplied document labels. */
export function presentDocumentKindIds(
  definitions: readonly { id: string; kind: string; label: string; aliases?: readonly string[] }[],
  labels: readonly string[],
): string[] {
  const haystack = labels.map(normalizeLabel).filter((label) => label !== "").join(" ");
  const found: string[] = [];
  for (const definition of definitions) {
    if (definition.kind !== "document") continue;
    const names = [definition.label, ...(definition.aliases ?? [])];
    if (names.some((name) => {
      const needle = normalizeLabel(name);
      return needle.length >= 3 && haystack.includes(needle);
    })) found.push(definition.id);
  }
  return found.sort();
}

export function intentQuestionIds(intent: string): string[] {
  const count = intent.split("?").map((part) => part.trim()).filter((part) => part.length >= 8).length;
  return Array.from({ length: count }, (_, index) => `intent:${index + 1}`);
}

function stateFor(window: PlannedInvestigationWindow, status: WindowProgressStatus): InvestigationWindowState {
  const unresolved = window.obligations
    .filter((item) => item.disposition === "EVIDENCE_MISSING" || item.disposition === "REVIEW_REQUIRED")
    .map((item) => item.obligationId);
  return {
    windowId: window.windowId,
    status,
    executable: window.executable,
    roundsUsed: 0,
    toolCallsUsed: 0,
    invalidCallsUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelTurns: 0,
    budgetRounds: window.budget?.rounds ?? 0,
    budgetToolCalls: window.budget?.toolCalls ?? 0,
    budgetInvalidCalls: window.budget?.invalidCalls ?? 0,
    budgetUsdCents: window.budget?.estimatedUsdCents ?? 0,
    acceptedFactIds: [],
    answeredQuestionIds: [],
    unresolvedObligationIds: unresolved,
    missingDocumentIds: window.missingDocumentIds,
    replay: [],
  };
}

export function startWindowProgress(plan: InvestigationWindowPlan): InvestigationWindowProgress {
  return {
    schema: INVESTIGATION_WINDOW_PROGRESS_SCHEMA,
    planDigest: plan.planDigest,
    intentDigest: plan.intentDigest,
    windows: plan.windows.map((window) => stateFor(window, window.executable ? "pending" : "settled")),
  };
}

function cloneProgress(progress: InvestigationWindowProgress): InvestigationWindowProgress {
  return {
    schema: progress.schema,
    planDigest: progress.planDigest,
    intentDigest: progress.intentDigest,
    windows: progress.windows.map((window) => ({
      ...window,
      acceptedFactIds: [...window.acceptedFactIds],
      answeredQuestionIds: [...window.answeredQuestionIds],
      unresolvedObligationIds: [...window.unresolvedObligationIds],
      missingDocumentIds: [...window.missingDocumentIds],
      replay: window.replay.map((call) => ({ ...call })),
    })),
  };
}

export function reopenInvestigationWindows(progress: InvestigationWindowProgress): InvestigationWindowProgress {
  const next = cloneProgress(progress);
  const open = next.windows.filter((window) => window.executable && window.status !== "complete" && window.status !== "blocked");
  const usedRounds = next.windows.reduce((sum, window) => sum + window.roundsUsed, 0);
  const usedCalls = next.windows.reduce((sum, window) => sum + window.toolCallsUsed, 0);
  const remainingRounds = STUDY_AGENT_BUDGET.maxRounds - 1 - usedRounds;
  const remainingCalls = STUDY_AGENT_BUDGET.maxToolCalls - 1 - usedCalls;
  if (open.length === 0 || remainingRounds <= 0 || remainingCalls <= 0) return next;
  const grant = allocateWindowBudgets(open.length);
  const addRounds = Math.max(1, Math.min(grant.rounds, Math.floor(remainingRounds / open.length)));
  const addCalls = Math.max(1, Math.min(grant.toolCalls, Math.floor(remainingCalls / open.length)));
  for (const window of open) {
    window.budgetRounds = window.roundsUsed + addRounds;
    window.budgetToolCalls = window.toolCallsUsed + addCalls;
    window.budgetInvalidCalls = window.invalidCallsUsed + grant.invalidCalls;
    window.budgetUsdCents = grant.estimatedUsdCents;
    if (window.status === "paused" || window.status === "running") window.status = "pending";
  }
  return next;
}

export function resumeWindowProgress(
  plan: InvestigationWindowPlan,
  saved: InvestigationWindowProgress | null | undefined,
): InvestigationWindowProgress {
  if (!saved || saved.schema !== INVESTIGATION_WINDOW_PROGRESS_SCHEMA || saved.planDigest !== plan.planDigest || saved.intentDigest !== plan.intentDigest) {
    return startWindowProgress(plan);
  }
  const fresh = startWindowProgress(plan);
  const previous = new Map(saved.windows.map((window) => [window.windowId, window]));
  const merged = fresh.windows.map((window) => {
    const prior = previous.get(window.windowId);
    if (!prior || prior.executable !== window.executable) return window;
    return {
      ...window,
      status: prior.status === "running" ? "pending" as const : prior.status,
      roundsUsed: prior.roundsUsed,
      toolCallsUsed: prior.toolCallsUsed,
      invalidCallsUsed: prior.invalidCallsUsed,
      inputTokens: prior.inputTokens,
      outputTokens: prior.outputTokens,
      modelTurns: prior.modelTurns,
      acceptedFactIds: [...prior.acceptedFactIds],
      answeredQuestionIds: [...prior.answeredQuestionIds],
      unresolvedObligationIds: [...new Set([...window.unresolvedObligationIds, ...prior.unresolvedObligationIds])].sort(),
      replay: prior.replay.filter((call) => ID_PATTERN.test(call.id) && call.name.trim() !== "").map((call) => ({ ...call })),
    };
  });
  return reopenInvestigationWindows({ ...fresh, windows: merged });
}

function replaceWindow(
  progress: InvestigationWindowProgress,
  windowId: string,
  update: (window: InvestigationWindowState) => InvestigationWindowState,
): InvestigationWindowProgress {
  return {
    ...progress,
    windows: progress.windows.map((window) => window.windowId === windowId ? update(window) : window),
  };
}

export function recordWindowTurn(
  progress: InvestigationWindowProgress,
  windowId: string,
  usage: { inputTokens: number; outputTokens: number; toolCalls: number; invalidCalls: number; calls: readonly WindowToolReplay[] },
): InvestigationWindowProgress {
  return replaceWindow(progress, windowId, (window) => {
    const replay = [...window.replay];
    for (const call of usage.calls) {
      if (!replay.some((item) => item.id === call.id)) replay.push({ id: call.id, name: call.name, arguments: call.arguments });
    }
    const roundsUsed = window.roundsUsed + 1;
    const toolCallsUsed = window.toolCallsUsed + usage.toolCalls;
    const overBudget = roundsUsed >= window.budgetRounds || toolCallsUsed >= window.budgetToolCalls;
    const status: WindowProgressStatus = overBudget ? "paused" : "running";
    return {
      ...window,
      status: window.status === "complete" || window.status === "settled" ? window.status : status,
      roundsUsed,
      toolCallsUsed,
      invalidCallsUsed: window.invalidCallsUsed + usage.invalidCalls,
      inputTokens: window.inputTokens + usage.inputTokens,
      outputTokens: window.outputTokens + usage.outputTokens,
      modelTurns: window.modelTurns + 1,
      replay,
    };
  });
}

export function completeInvestigationWindow(
  progress: InvestigationWindowProgress,
  windowId: string,
  accepted: { factIds: readonly string[]; questionIds: readonly string[] },
): InvestigationWindowProgress {
  return replaceWindow(progress, windowId, (window) => ({
    ...window,
    status: "complete",
    acceptedFactIds: [...new Set([...window.acceptedFactIds, ...accepted.factIds])].sort(),
    answeredQuestionIds: [...new Set([...window.answeredQuestionIds, ...accepted.questionIds])].sort(),
  }));
}

export function blockInvestigationWindow(progress: InvestigationWindowProgress, windowId: string): InvestigationWindowProgress {
  return replaceWindow(progress, windowId, (window) => ({ ...window, status: "blocked" }));
}

export function pauseInvestigationWindow(progress: InvestigationWindowProgress, windowId: string): InvestigationWindowProgress {
  return replaceWindow(progress, windowId, (window) => (
    window.status === "complete" || window.status === "settled" ? window : { ...window, status: "paused" }
  ));
}

function settledDependency(progress: InvestigationWindowProgress, windowId: string): boolean {
  const window = progress.windows.find((item) => item.windowId === windowId);
  return !!window && (window.status === "complete" || window.status === "settled");
}

/** The ready window with the least model time. Completed windows are not selected. */
export function selectNextInvestigationWindow(
  plan: InvestigationWindowPlan,
  progress: InvestigationWindowProgress,
): PlannedInvestigationWindow | null {
  if (plan.dependencyCycle || plan.planDigest !== progress.planDigest) return null;
  const spentRounds = progress.windows.reduce((sum, window) => sum + window.roundsUsed, 0);
  const spentCalls = progress.windows.reduce((sum, window) => sum + window.toolCallsUsed, 0);
  if (spentRounds >= STUDY_AGENT_BUDGET.maxRounds - 1 || spentCalls >= STUDY_AGENT_BUDGET.maxToolCalls - 1) return null;
  const ready = plan.windows.filter((window) => {
    const state = progress.windows.find((item) => item.windowId === window.windowId);
    if (!state || !window.executable) return false;
    if (state.status === "complete" || state.status === "settled" || state.status === "blocked" || state.status === "paused") return false;
    if (state.roundsUsed >= state.budgetRounds || state.toolCallsUsed >= state.budgetToolCalls) return false;
    return window.dependsOnWindowIds.every((dependency) => settledDependency(progress, dependency));
  });
  ready.sort((left, right) => {
    const leftState = progress.windows.find((item) => item.windowId === left.windowId);
    const rightState = progress.windows.find((item) => item.windowId === right.windowId);
    const rounds = (leftState?.roundsUsed ?? 0) - (rightState?.roundsUsed ?? 0);
    if (rounds !== 0) return rounds;
    return left.windowId.localeCompare(right.windowId);
  });
  return ready[0] ?? null;
}

export function investigationWindowsRemain(plan: InvestigationWindowPlan, progress: InvestigationWindowProgress): boolean {
  return plan.windows.some((window) => {
    const state = progress.windows.find((item) => item.windowId === window.windowId);
    return window.executable && state && state.status !== "complete" && state.status !== "blocked" && state.status !== "settled";
  });
}

/** Log and bookmark shape. Tool arguments are omitted. */
export function investigationWindowProgressForLog(progress: InvestigationWindowProgress): InvestigationWindowProgress {
  return {
    ...progress,
    windows: progress.windows.map((window) => ({ ...window, replay: [] })),
  };
}

export function priorAcceptedFactIds(progress: InvestigationWindowProgress, windowId: string): string[] {
  return [...new Set(progress.windows.filter((window) => window.windowId !== windowId).flatMap((window) => window.acceptedFactIds))].sort();
}
