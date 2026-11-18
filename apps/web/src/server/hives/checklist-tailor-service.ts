import {
  applyChecklistTailorRules,
  checklistTailorWithoutModel,
  parseChecklistTailorModelOutput,
  packRowsForTailor,
  type ChecklistTailorModelOutput,
  type ChecklistTailorResult,
  MAX_TAILOR_PROFESSIONAL_TEXT,
} from "@hiveforyou/contracts";
import type { Pack } from "@hiveforyou/contracts";

import { emitStructuredEvent } from "@/server/observability/logger";
import { MODEL_REGISTRY } from "@/server/models/model-registry";

export const TAILOR_FALLBACK_MESSAGE = "Couldn't tailor right now. Showing the usual list.";

export type ChecklistTailorModelRunner = (input: {
  packTitle: string;
  rows: ReturnType<typeof packRowsForTailor>;
  professionalText: string;
  correlationId: string;
}) => Promise<{ ok: true; output: ChecklistTailorModelOutput; modelId: string; latencyMs: number } | { ok: false }>;

export function buildTailorUserPayload(pack: Pack, professionalText: string) {
  const rows = packRowsForTailor(pack);
  return {
    packTitle: pack.meta.title,
    professionalText,
    rows: rows.map((row) => ({
      key: row.key,
      title: row.title,
      appliesWhen: row.appliesWhen,
    })),
  };
}

export async function runChecklistTailor(
  pack: Pack,
  professionalText: string,
  correlationId: string,
  runModel: ChecklistTailorModelRunner | null,
): Promise<ChecklistTailorResult> {
  const text = professionalText.replace(/\s+/g, " ").trim();
  if (text.length > MAX_TAILOR_PROFESSIONAL_TEXT) {
    return {
      ...checklistTailorWithoutModel(packRowsForTailor(pack), true),
      message: TAILOR_FALLBACK_MESSAGE,
    };
  }

  const packRows = packRowsForTailor(pack);
  if (text === "") {
    return checklistTailorWithoutModel(packRows, false);
  }

  if (!runModel) {
    return { ...checklistTailorWithoutModel(packRows, true), message: TAILOR_FALLBACK_MESSAGE };
  }

  const started = Date.now();
  const registry = MODEL_REGISTRY.checklist_tailor;
  try {
    const modelResult = await runModel({
      packTitle: pack.meta.title,
      rows: packRows,
      professionalText: text,
      correlationId,
    });
    if (!modelResult.ok) {
      emitTailorOutcome(correlationId, registry.promptId, null, Date.now() - started, "fallback");
      return { ...checklistTailorWithoutModel(packRows, true), message: TAILOR_FALLBACK_MESSAGE };
    }
    const parsed = parseChecklistTailorModelOutput(modelResult.output);
    if (!parsed) {
      emitTailorOutcome(correlationId, registry.promptId, modelResult.modelId, modelResult.latencyMs, "invalid_output");
      return { ...checklistTailorWithoutModel(packRows, true), message: TAILOR_FALLBACK_MESSAGE };
    }
    emitTailorOutcome(correlationId, registry.promptId, modelResult.modelId, modelResult.latencyMs, "ok");
    return applyChecklistTailorRules(packRows, text, parsed);
  } catch {
    emitTailorOutcome(correlationId, registry.promptId, null, Date.now() - started, "error");
    return { ...checklistTailorWithoutModel(packRows, true), message: TAILOR_FALLBACK_MESSAGE };
  }
}

function emitTailorOutcome(
  correlationId: string,
  promptVersion: string,
  modelId: string | null,
  latencyMs: number,
  outcome: string,
): void {
  emitStructuredEvent({
    eventName: "checklist_tailor.completed",
    severity: "INFO",
    timestamp: new Date().toISOString(),
    component: "hives",
    operation: "checklistTailor",
    stage: "SHELL",
    correlationId,
    status: outcome === "ok" ? "OK" : "FAILED",
    durationMs: latencyMs,
    diagnosticReason: outcome,
    task: promptVersion,
    diagnosticField: modelId ?? outcome,
  });
}