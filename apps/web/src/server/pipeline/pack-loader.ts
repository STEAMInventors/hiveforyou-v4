import { emitStructuredEvent } from "@/server/observability/logger";

export type { PackIndexEntry, PackIndexLoadResult } from "./pack-loader-core";
export {
  loadPackById,
  loadPackEntries,
  packArchiveFileName,
  resolvePacksRoot,
} from "./pack-loader-core";

export type PinnedPackMissingLog = {
  correlationId?: string;
  hiveId?: string;
  processingRunId?: string;
  packId: string;
  packVersion: number;
  stage?: string;
};

/** WARN when a study pins a pack version that cannot be resolved (never fall back to another version). */
export function logPinnedPackNotFound(input: PinnedPackMissingLog): void {
  if (!input.correlationId) return;
  emitStructuredEvent({
    eventName: "pipeline.pack.pinned_version_missing",
    severity: "WARN",
    timestamp: new Date().toISOString(),
    component: "pipeline",
    operation: "pack_load",
    stage: input.stage ?? "WRITE",
    correlationId: input.correlationId,
    ...(input.processingRunId ? { processingRunId: input.processingRunId } : {}),
    ...(input.hiveId ? { hiveId: input.hiveId } : {}),
    diagnosticReason: "pack_pinned_version_not_found",
    diagnosticField: `${input.packId}@${input.packVersion}`,
  });
}
