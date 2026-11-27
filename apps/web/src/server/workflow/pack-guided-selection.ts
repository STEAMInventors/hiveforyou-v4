import { PACK_GUIDED_STUDY_ENGINE_ID } from "@hiveforyou/contracts/study-engine";

const pending = new Set<string>();

/**
 * Server opt-in for one synthetic pack-guided rebuild.
 * Vercel sets NODE_ENV=production for preview and production, so NODE_ENV is not the gate.
 * The value must be exactly `synthetic`. Vercel production stays closed even if the variable is set.
 * A matching value does not authorize a real case. The synthetic page registry still has to match.
 */
export const SYNTHETIC_STUDY_ENGINE_ENV = "HIVE_SYNTHETIC_STUDY_ENGINE";
export const SYNTHETIC_STUDY_ENGINE_VALUE = "synthetic";

export function packGuidedSelectionAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV === "production") return false;
  return env[SYNTHETIC_STUDY_ENGINE_ENV] === SYNTHETIC_STUDY_ENGINE_VALUE;
}

/** Remembers an explicit pack-guided rebuild for this process. A closed gate never calls this. */
export function markPackGuidedRebuild(runId: string): void {
  if (!packGuidedSelectionAllowed()) return;
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
