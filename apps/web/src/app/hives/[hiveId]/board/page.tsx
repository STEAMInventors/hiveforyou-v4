import { HiveConversation } from "@/components/hives/HiveConversation";
import { HiveStillToCome } from "@/components/hives/HiveStillToCome";
import { HiveHandoverBanner } from "@/components/workspace/HiveHandoverBanner";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadLatestHandover } from "@/server/firm/load-firm-board";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { loadHiveConversation } from "@/server/hives/hive-conversation";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type BoardPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function HiveBoardPage({ params }: BoardPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/board`);
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return null;
  }

  const correlationId = await requestCorrelationId();
  const staffView = showsFirmThreePane(hive);
  const isAssignee = hive.assigneeUserId?.toLowerCase() === auth.userId.toLowerCase() && hive.stage !== "closed";

  const [conversation, board, handover] = await Promise.all([
    loadHiveConversation(auth.client, hive.id, correlationId),
    loadHiveBoard(auth.client, { hive, correlationId, userId: auth.userId })
      .then((loaded) => loaded.board)
      .catch(() => null),
    staffView && isAssignee ? loadLatestHandover(auth.client, hive.id).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <>
      {handover ? <HiveHandoverBanner handover={handover} visible /> : null}
      <HivePageHead title="Hive board" />
      <div className="mx-auto flex w-full max-w-[940px] flex-col gap-3" data-testid="hive-board">
        <HiveStillToCome hiveId={hive.id} progress={board && board.checklist.length > 0 ? board.progress : null} />
        <HiveConversation
          hiveId={hive.id}
          initial={conversation}
          staffView={staffView}
          clientName={hive.kind === "client" ? hive.name : null}
          viewerIsClient={hive.membershipRole === "client"}
        />
      </div>
    </>
  );
}
