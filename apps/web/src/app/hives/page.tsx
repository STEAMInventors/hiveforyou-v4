import type { Hive } from "@hiveforyou/contracts";
import { redirect } from "next/navigation";

import { MyHivesPanel } from "@/components/hives/MyHivesPanel";
import { CREATE_HIVE_PARAM } from "@/lib/hive-routes";
import { requestCorrelationId } from "@/server/auth/action-support";
import { listHivesViaEdge } from "@/server/hives/hive-edge-gateway";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type MyHivesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MyHivesPage({ searchParams }: MyHivesPageProps) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    redirect("/login?next=%2Fhives");
  }

  const params = await searchParams;
  const correlationId = await requestCorrelationId();
  let hives: Hive[] = [];
  let initialError: { message: string; correlationId: string } | null = null;

  try {
    const result = await listHivesViaEdge(auth.client, correlationId);
    hives = result.hives;
  } catch (error) {
    initialError = {
      message:
        error && typeof error === "object" && "safeMessage" in error
          ? String((error as { safeMessage: string }).safeMessage)
          : "Could not load your Hives.",
      correlationId,
    };
  }

  return (
    <MyHivesPanel
      initialHives={hives}
      initialError={initialError}
      openCreateOnLoad={params[CREATE_HIVE_PARAM] === "1"}
    />
  );
}
