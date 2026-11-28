import { createHiveError, type HiveError } from "@hiveforyou/contracts";
import { PACK_GUIDED_STUDY_ENGINE_ID } from "@hiveforyou/contracts/study-engine";

const pending = new Set<string>();
const DIAGNOSTIC_FIELD = /^[A-Za-z][A-Za-z0-9_.:/\[\]@+-]{0,127}$/;

/** Same-process hint. A worker in another process must read the persisted run instead. */
export function markPackGuidedRebuild(runId: string): void {
  pending.add(runId.trim().toLowerCase());
}

export function isPackGuidedRebuild(
  runId: string,
  stageOutputs?: { domainPack?: { engine?: string } | { id?: string } | { skipped?: string } },
): boolean {
  if (pending.has(runId.trim().toLowerCase())) return true;
  const pack = stageOutputs?.domainPack;
  return !!pack && "engine" in pack && pack.engine === PACK_GUIDED_STUDY_ENGINE_ID;
}

/** Safe failure text that names the engine, pack version, stage, and window count. */
export function studyEngineDiagnostic(input: {
  engine: string;
  packVersion: string;
  stage: string;
  windowsComplete: number;
  windowsTotal: number;
  code: string;
}): { sentence: string; field: string } {
  const version = input.packVersion.trim() || "unknown";
  const stage = input.stage.trim() || "CANONICALIZING";
  const done = Number.isInteger(input.windowsComplete) && input.windowsComplete >= 0 ? input.windowsComplete : 0;
  const total = Number.isInteger(input.windowsTotal) && input.windowsTotal >= 0 ? input.windowsTotal : 0;
  const code = input.code.trim() || "investigation_engine_failed";
  const sentence = `Engine ${input.engine}, pack version ${version}, stage ${stage}, ${done} of ${total} windows complete. Reason: ${code}.`;
  const full = `engine@${input.engine}/version@${version}/stage@${stage}/windows@${done}/${total}/code@${code}`;
  const compact = `engine@${input.engine}/version@${version}/stage@${stage}/windows@${done}/${total}`;
  const field = DIAGNOSTIC_FIELD.test(full) ? full : DIAGNOSTIC_FIELD.test(compact) ? compact : "engine@pack-guided";
  return { sentence, field };
}

/** Keeps the original reason and adds the engine facts to the message and diagnostic field. */
export function withStudyEngineDiagnostic(
  error: HiveError,
  facts: { engine: string; packVersion: string; stage: string; windowsComplete: number; windowsTotal: number },
): HiveError {
  const label = studyEngineDiagnostic({ ...facts, code: error.diagnosticReason ?? "investigation_engine_failed" });
  const named = error.safeMessage.includes(`Engine ${facts.engine}`) && error.safeMessage.includes("windows complete");
  return createHiveError({
    errorCode: error.errorCode,
    category: error.category,
    stage: error.stage,
    retryable: error.retryable,
    safeMessage: (named ? error.safeMessage : `${label.sentence} ${error.safeMessage}`).slice(0, 280),
    correlationId: error.correlationId,
    operationId: error.operationId,
    diagnosticReason: error.diagnosticReason,
    diagnosticField: error.diagnosticField && DIAGNOSTIC_FIELD.test(error.diagnosticField) ? error.diagnosticField : label.field,
  });
}

export { PACK_GUIDED_STUDY_ENGINE_ID };
