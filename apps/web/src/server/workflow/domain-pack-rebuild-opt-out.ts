const pending = new Set<string>();

/** Marks a rebuild run to skip domain pack selection (user opted out of the checklist). */
export function markRebuildWithoutDomainPack(runId: string): void {
  pending.add(runId.trim().toLowerCase());
}

/** Returns true once per run, then clears the marker. */
export function consumeRebuildWithoutDomainPack(runId: string): boolean {
  const key = runId.trim().toLowerCase();
  if (!pending.has(key)) return false;
  pending.delete(key);
  return true;
}
