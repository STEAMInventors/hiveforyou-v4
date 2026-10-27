import { isValidUuid, type Hive } from "@hiveforyou/contracts";
import { notFound, redirect } from "next/navigation";

import { requestCorrelationId } from "@/server/auth/action-support";
import { getHiveViaEdge } from "@/server/hives/hive-edge-gateway";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export async function loadOwnedHiveOrNotFound(
  hiveId: string,
  returnPath: string,
): Promise<Hive> {
  const trimmed = hiveId.trim().toLowerCase();
  if (!isValidUuid(trimmed)) {
    notFound();
  }

  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  }

  const correlationId = await requestCorrelationId();
  try {
    const response = await getHiveViaEdge(auth.client, trimmed, correlationId);
    return response.hive;
  } catch (error) {
    const code =
      error && typeof error === "object" && "errorCode" in error
        ? String((error as { errorCode?: unknown }).errorCode)
        : "";
    if (code === "UNAUTHENTICATED") {
      redirect(`/login?next=${encodeURIComponent(returnPath)}`);
    }
    if (
      code === "NOT_FOUND" ||
      code === "ACCESS_DENIED" ||
      code === "INVALID_REQUEST"
    ) {
      notFound();
    }
    throw error;
  }
}
