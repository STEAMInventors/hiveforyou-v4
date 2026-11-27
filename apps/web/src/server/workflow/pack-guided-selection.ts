import { PACK_GUIDED_STUDY_ENGINE_ID } from "@hiveforyou/contracts/study-engine";

const pending = new Set<string>();

/** Remembers an explicit pack-guided rebuild for this process. */
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

export { PACK_GUIDED_STUDY_ENGINE_ID };
