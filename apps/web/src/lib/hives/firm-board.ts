import type { Hive } from "@hiveforyou/contracts";

/** Firm staff see the three-pane board on a client hive. Own hives, and the client, keep the FL-4 board. */
export function showsFirmThreePane(hive: Hive): boolean {
  return hive.kind === "client" && Boolean(hive.firmId) && hive.membershipRole !== "client";
}

export function personFirstName(name: string): string {
  const token = name.trim().split(/\s+/)[0] ?? "";
  return token || name.trim();
}
