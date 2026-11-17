import type { ReactNode } from "react";

import { HiveWorkspaceFrame } from "@/server/hives/hive-workspace-frame";
import { hiveWorkspaceStartingView } from "@/server/hives/hive-workspace-props";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { requestCorrelationId } from "@/server/auth/action-support";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type HiveLayoutProps = {
  children: ReactNode;
  params: Promise<{ hiveId: string }>;
};

export default async function HiveLayout({ children, params }: HiveLayoutProps) {
  const { hiveId } = await params;
  const returnPath = `/hives/${hiveId}/board`;
  const hive = await loadOwnedHiveOrNotFound(hiveId, returnPath);
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return <div data-hive-id={hiveId}>{children}</div>;
  }
  const correlationId = await requestCorrelationId();
  const startingView = await hiveWorkspaceStartingView(auth);

  return (
    <HiveWorkspaceFrame hive={hive} auth={auth} startingView={startingView} correlationId={correlationId}>
      {children}
    </HiveWorkspaceFrame>
  );
}