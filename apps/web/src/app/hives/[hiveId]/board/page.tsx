import { Suspense } from "react";

import { HiveBoardMessaging } from "@/components/hives/HiveBoardMessaging";
import { HiveStillToCome } from "@/components/hives/HiveStillToCome";
import { HiveHandoverBanner } from "@/components/workspace/HiveHandoverBanner";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadLatestHandover } from "@/server/firm/load-firm-board";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { documentPageCounts } from "@/server/hives/hive-summary";
import { loadHiveConversation } from "@/server/hives/hive-conversation";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type BoardPageProps = {
  params: Promise<{ hiveId: string }>;
  searchParams: Promise<{ view?: string }>;
};

export default async function HiveBoardPage({ params, searchParams }: BoardPageProps) {
  const { hiveId } = await params;
  const { view } = (await searchParams) ?? {};
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/board`);
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return null;
  }

  const correlationId = await requestCorrelationId();
  const staffView = showsFirmThreePane(hive);
  const isAssignee = hive.assigneeUserId?.toLowerCase() === auth.userId.toLowerCase() && hive.stage !== "closed";

  const firmless = hive.firmId == null;
  const askFirst = firmless || view === "ask";
  const [initialPeople, initialAsk, boardLoad, handover, firmRow] = await Promise.all([
    askFirst ? Promise.resolve(null) : loadHiveConversation(auth.client, hive.id, correlationId, { channel: "people" }),
    loadHiveConversation(auth.client, hive.id, correlationId, {
      channel: "assistant",
      threadOwnerUserId: auth.userId,
    }),
    loadHiveBoard(auth.client, { hive, correlationId, userId: auth.userId }).catch(() => null),
    staffView && isAssignee ? loadLatestHandover(auth.client, hive.id).catch(() => null) : Promise.resolve(null),
    hive.firmId
      ? auth.client.schema("hive").from("firms").select("assistant_name").eq("id", hive.firmId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const conversationPeople =
    initialPeople ?? ({ ok: true, page: { messages: [], participantRoleLabels: [], participantCount: 0, viewerLastReadAt: null, nextCursor: null } } as const);
  const assistantName =
    typeof (firmRow.data as { assistant_name?: string } | null)?.assistant_name === "string"
      ? (firmRow.data as { assistant_name: string }).assistant_name.trim() || "HiveForYou"
      : "HiveForYou";
  const board = boardLoad?.board ?? null;
  const overview = boardLoad?.overview;

  return (
    <>
      {handover ? <HiveHandoverBanner handover={handover} visible /> : null}
      <HivePageHead title="Hive board" />
      <div className="mx-auto flex w-full max-w-col-read flex-col gap-3" data-testid="hive-board">
        <HiveStillToCome hiveId={hive.id} progress={board && board.checklist.length > 0 ? board.progress : null} />
        <Suspense fallback={null}>
          <HiveBoardMessaging
            hiveId={hive.id}
          firmless={firmless}
          assistantName={assistantName}
          currentUserId={auth.userId}
          initialPeople={conversationPeople}
          initialAsk={initialAsk}
          teamMemberFirstName="your team"
          staffView={staffView}
          clientName={hive.kind === "client" ? hive.name : null}
          viewerIsClient={hive.membershipRole === "client"}
          hiveFirmId={hive.firmId ?? null}
          studyView={overview?.studyTab?.view ?? null}
          studySources={overview?.studyTab?.sources ?? null}
          canonicalStudy={overview?.canonicalStudy ?? null}
          coverageGaps={overview?.preparation.studyRevision?.coverageGaps ?? []}
          documentPages={overview ? documentPageCounts(overview.preparation) : undefined}
          />
        </Suspense>
      </div>
    </>
  );
}
