import {
  buildFindingsOpenItems,
  buildFindingsTopics,
  isValidUuid,
} from "@hiveforyou/contracts";
import { notFound, redirect } from "next/navigation";

import { HiveHome, type HiveHomeViewer } from "@/components/home/HiveHome";
import { buildHiveHomeContent } from "@/components/home/home-model";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { hiveDocumentsPath } from "@/lib/hive-routes";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { loadHiveConversation } from "@/server/hives/hive-conversation";
import { documentPageCounts, loadHiveOverview, type HiveOverview } from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { loadPackById } from "@/server/pipeline/pack-loader";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type HiveRootPageProps = {
  params: Promise<{ hiveId: string }>;
};

function loadFailure(error: unknown): { message: string; correlationId: string; retryable: boolean } {
  const record =
    error && typeof error === "object"
      ? (error as { safeMessage?: unknown; retryable?: unknown; correlationId?: unknown })
      : null;
  const message =
    typeof record?.safeMessage === "string" && record.safeMessage.trim() !== ""
      ? record.safeMessage
      : "We couldn't load this hive.";
  return {
    message,
    correlationId: typeof record?.correlationId === "string" ? record.correlationId : "",
    retryable: record?.retryable === true,
  };
}

function homeViewer(hive: { firmId?: string | null; membershipRole?: string | null }): HiveHomeViewer {
  if (hive.firmId == null) return "firmless";
  if (hive.membershipRole === "client") return "client";
  return "staff";
}

export default async function HiveRootPage({ params }: HiveRootPageProps) {
  const { hiveId } = await params;
  const trimmed = hiveId.trim().toLowerCase();
  if (!isValidUuid(trimmed)) {
    notFound();
  }
  const hive = await loadOwnedHiveOrNotFound(trimmed, `/hives/${trimmed}`);
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return null;

  const correlationId = await requestCorrelationId();
  let overview: HiveOverview | null = null;
  let checklist: { title: string; status: string }[] | null = null;
  let progress: { in: number; total: number } | null = null;
  let loadError: { message: string; correlationId: string; retryable: boolean } | null = null;

  try {
    const boardLoad = await loadHiveBoard(auth.client, { hive, correlationId, userId: auth.userId });
    overview = boardLoad.overview;
    checklist = boardLoad.board.checklist.map((item) => ({ title: item.title, status: item.status }));
    progress = boardLoad.board.progress;
  } catch (error) {
    try {
      overview = await loadHiveOverview(auth.client, { hiveId: hive.id, correlationId });
    } catch (overviewError) {
      const failure = loadFailure(overviewError);
      loadError = { ...failure, correlationId: failure.correlationId || correlationId };
    }
    if (!overview && !loadError) loadError = loadFailure(error);
  }

  if (overview && overview.summary.documentCount === 0) {
    redirect(hiveDocumentsPath(hive.id));
  }

  const [people, firmRow] = await Promise.all([
    loadHiveConversation(auth.client, hive.id, correlationId, { channel: "people" }),
    hive.firmId
      ? auth.client.schema("hive").from("firms").select("assistant_name").eq("id", hive.firmId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const assistantName =
    typeof (firmRow.data as { assistant_name?: string } | null)?.assistant_name === "string"
      ? (firmRow.data as { assistant_name: string }).assistant_name.trim() || "HiveForYou"
      : "HiveForYou";

  const view = overview?.studyTab?.view ?? null;
  const sources = overview?.studyTab?.sources ?? null;
  const canonicalStudy = overview?.canonicalStudy ?? null;
  const pack =
    canonicalStudy?.packRef != null
      ? loadPackById(canonicalStudy.packRef.id, canonicalStudy.packRef.version)
      : null;
  const openItems = view ? buildFindingsOpenItems(view, canonicalStudy) : [];
  const topics = view
    ? buildFindingsTopics({ view, canonicalStudy, pack, openItems }).topics
    : [];
  const revision = overview?.preparation.studyRevision ?? null;
  const content = overview
    ? buildHiveHomeContent({
        documentCount: overview.summary.documentCount,
        checklist,
        progress,
        openItems,
        topics,
        sources,
        messages: people.ok ? people.page.messages : [],
        now: new Date(),
        study: revision ? { revisionNumber: revision.revisionNumber, acceptedAt: revision.createdAt } : null,
        documentRows: view?.blocks.find((block) => block.name === "documents")?.rows ?? [],
        calculations: pack?.computedValues ?? [],
      })
    : null;

  const viewer = homeViewer(hive);
  return (
    <HiveHome
      hiveId={hive.id}
      viewer={viewer}
      clientName={hive.kind === "client" ? hive.name : null}
      staffName={hive.assigneeDisplayName?.trim() || null}
      assistantName={assistantName}
      content={content}
      loadError={loadError}
      conflicts={view?.blocks.find((block) => block.name === "conflicts")?.rows ?? []}
      timeline={view?.blocks.find((block) => block.name === "timeline")?.rows ?? []}
      view={view}
      sources={sources}
      canonicalStudy={canonicalStudy}
      coverageGaps={revision?.coverageGaps ?? []}
      documentPages={overview ? documentPageCounts(overview.preparation) : undefined}
      initialPeople={people}
      currentUserId={auth.userId}
      staffView={showsFirmThreePane(hive)}
      viewerIsClient={hive.membershipRole === "client"}
      hiveFirmId={hive.firmId ?? null}
    />
  );
}
