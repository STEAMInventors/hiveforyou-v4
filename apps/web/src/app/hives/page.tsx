import type { Hive } from "@hiveforyou/contracts";
import { redirect } from "next/navigation";

import { MyHivesPanel } from "@/components/hives/MyHivesPanel";
import { requestCorrelationId } from "@/server/auth/action-support";
import { listHivesViaEdge } from "@/server/hives/hive-edge-gateway";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function MyHivesPage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    redirect("/login?next=%2Fhives");
  }

  const correlationId = await requestCorrelationId();
  let hives: Hive[] = [];
  let initialError: string | null = null;

  try {
    const result = await listHivesViaEdge(auth.client, correlationId);
    hives = result.hives;
  } catch (error) {
    initialError =
      error && typeof error === "object" && "safeMessage" in error
        ? String((error as { safeMessage: string }).safeMessage)
        : "Could not load your Hives.";
  }

  return <MyHivesPanel initialHives={hives} initialError={initialError} />;
}
