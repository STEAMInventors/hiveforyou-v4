import type { Hive } from "@hiveforyou/contracts";

export function isHiveDeletionPending(hive: Pick<Hive, "deletingAt">): boolean {
  return hive.deletingAt != null;
}
