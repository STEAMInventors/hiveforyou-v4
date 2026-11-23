import {
  buildFindingsOpenItems,
  buildFindingsTopics,
  isValidUuid,
} from "@hiveforyou/contracts";
import { notFound, redirect } from "next/navigation";

import type { HiveBoardChecklistItem, RequestItem, SourceDocument } from "@hiveforyou/contracts";

import { ClientHome } from "@/components/home/ClientHome";
import { HiveHome, type HiveHomeViewer } from "@/components/home/HiveHome";
import { PersonalHiveBoard } from "@/components/hives/PersonalHiveBoard";
import { personalHiveRoster } from "@/components/hives/personal-hive-roster";
import { buildHiveHomeContent } from "@/components/home/home-model";
import { showsFirmThreePane } from "@/lib/hives/firm-board";
import { studyAvailability } from "@/lib/hives/study-availability";
import { hiveDocumentsPath } from "@/lib/hive-routes";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadFirm } from "@/server/firm/load-firm";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { loadHiveConversation } from "@/server/hives/hive-conversation";
import {
  authorizedSourceDocumentIds,
  documentPageCounts,
  hiveWorkspaceDocuments,
  loadHiveOverview,
  loadWorkspaceTimeline,
  resolveWorkspaceLegacyHome,
  workspaceStudyView,
  type HiveOverview,
} from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { loadPackById } from "@/server/pipeline/pack-loader";
import { createLiveHiveVaultUploadAdapterDeps, listHiveSourceDocumentsWithV3Vault } from "@/server/source-documents/hive-vault-upload-adapter";
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
  let boardChecklist: readonly HiveBoardChecklistItem[] = [];
  let checklist: { title: string; status: string }[] | null = null;
  let progress: { in: number; total: number } | null = null;
  let requests: readonly RequestItem[] = [];
  let loadError: { message: string; correlationId: string; retryable: boolean } | null = null;

  try {
    const boardLoad = await loadHiveBoard(auth.client, { hive, correlationId, userId: auth.userId });
    overview = boardLoad.overview;
    boardChecklist = boardLoad.board.checklist;
    checklist = boardLoad.board.checklist.map((item) => ({ title: item.title, status: item.status }));
    progress = boardLoad.board.progress;
    requests = boardLoad.requests;
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

  const personal = hive.firmId == null;
  const [people, firmRow, askLoad, rosterResult] = await Promise.all([
    loadHiveConversation(auth.client, hive.id, correlationId, { channel: "people" }),
    hive.firmId
      ? auth.client.schema("hive").from("firms").select("assistant_name").eq("id", hive.firmId).maybeSingle()
      : Promise.resolve({ data: null }),
    personal
      ? loadHiveConversation(auth.client, hive.id, correlationId, { channel: "assistant" })
      : Promise.resolve(null),
    personal
      ? auth.client.rpc("list_hive_people", { p_hive_id: hive.id })
      : Promise.resolve({ data: null }),
  ]);
  let assistantName =
    typeof (firmRow.data as { assistant_name?: string } | null)?.assistant_name === "string"
      ? (firmRow.data as { assistant_name: string }).assistant_name.trim() || "HiveForYou"
      : "HiveForYou";

  const workspaceView = overview ? workspaceStudyView(overview) : { view: null, sources: null };
  const view = workspaceView.view;
  const sources = workspaceView.sources;
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
  const workspaceDocuments = overview ? hiveWorkspaceDocuments(overview.preparation) : undefined;
  const availability = overview
    ? studyAvailability({
        revision,
        hasCanonicalView: view != null,
        studyLoadError: overview.studyLoadError,
      })
    : null;
  const resolvedTimeline = overview
    ? await loadWorkspaceTimeline(auth.client, {
        hiveId: hive.id,
        overview,
        correlationId,
      })
    : null;
  const timeline = resolvedTimeline?.rows ?? [];
  const legacyHome = overview && !view ? resolveWorkspaceLegacyHome(overview) : null;
  const legacyDocuments =
    overview && !view
      ? (() => {
          const allowed = new Set(
            authorizedSourceDocumentIds(overview.preparation).map((id) => id.toLowerCase()),
          );
          return overview.preparation.eligibility.documents
            .filter((doc) => allowed.has(doc.sourceDocumentId.toLowerCase()))
            .map((doc) => ({
              sourceDocumentId: doc.sourceDocumentId,
              fileName: doc.fileName,
              eligible: true,
            }));
        })()
      : undefined;
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
        legacyHome,
        legacyDocuments,
      })
    : null;

  const viewer = homeViewer(hive);
  const acceptedStudyRevisionId = revision?.id ?? null;

  if (personal) {
    let uploadedDocuments: { id: string; fileName: string; createdAt: string }[] = [];
    if (hive.isOwner) {
      try {
        const deps = createLiveHiveVaultUploadAdapterDeps(auth.client, correlationId);
        const listed = await listHiveSourceDocumentsWithV3Vault(deps, {
          ownerUserId: auth.userId,
          hiveId: hive.id,
          correlationId,
        });
        uploadedDocuments = listed.sourceDocuments.map((document) => ({
          id: document.sourceDocumentId,
          fileName: document.fileName,
          createdAt: document.createdAt,
        }));
      } catch {
        uploadedDocuments = [];
      }
    }
    const ask = askLoad ?? {
      ok: false as const,
      message: "Could not load the conversation. Try again.",
      correlationId,
      retryable: true,
    };
    return (
      <PersonalHiveBoard
        hive={hive}
        assistantName={assistantName}
        summary={
          content
            ? {
                hasStudy: content.hasStudy,
                documentsIn: content.documentsIn,
                checklistSize: content.checklistSize,
                toReview: content.toReview,
                stillToCome: content.stillToCome.length,
                study: content.study,
              }
            : null
        }
        requests={requests}
        uploadedDocuments={uploadedDocuments}
        initialPeople={people}
        initialAsk={ask}
        currentUserId={auth.userId}
        roster={personalHiveRoster(rosterResult.data)}
        loadError={loadError}
        studyLoadError={overview?.studyLoadError ?? null}
        view={view}
        sources={sources}
        canonicalStudy={canonicalStudy}
        coverageGaps={revision?.coverageGaps ?? []}
        documentPages={overview ? documentPageCounts(overview.preparation) : undefined}
      />
    );
  }

  if (viewer === "client") {
    let initialDocuments: SourceDocument[] = [];
    let staffTitle: string | null = null;
    if (hive.firmId) {
      const firm = await loadFirm(auth.client);
      if (firm) {
        const assistant = firm.firm?.assistantName?.trim();
        if (assistant) assistantName = assistant;
        const members = firm.members.filter((member) => member.joined && member.state === "active" && member.userId);
        const assignee = members.find(
          (member) =>
            member.userId && hive.assigneeUserId && member.userId.toLowerCase() === hive.assigneeUserId.toLowerCase(),
        );
        staffTitle = assignee?.title ?? null;
      }
    }
    try {
      const deps = createLiveHiveVaultUploadAdapterDeps(auth.client, correlationId);
      const listed = await listHiveSourceDocumentsWithV3Vault(deps, {
        ownerUserId: auth.userId,
        hiveId: hive.id,
        correlationId,
      });
      initialDocuments = listed.sourceDocuments;
    } catch {
      // Client home still renders; gap upload falls back to Documents.
    }

    return (
      <ClientHome
        hiveId={hive.id}
        hiveTitle={hive.name}
        staffDisplayName={hive.assigneeDisplayName?.trim() || null}
        staffTitle={staffTitle}
        assistantName={assistantName}
        checklist={boardChecklist}
        requests={requests}
        progress={progress}
        openItems={openItems}
        initialDocuments={initialDocuments}
        acceptedStudyRevisionId={acceptedStudyRevisionId}
        initialPeople={people}
        currentUserId={auth.userId}
        hiveFirmId={hive.firmId ?? null}
        loadError={loadError}
        studyLoadError={overview?.studyLoadError ?? null}
        studyAvailability={availability}
        initialPreparation={overview?.preparation}
        view={view}
        sources={sources}
        canonicalStudy={canonicalStudy}
        coverageGaps={revision?.coverageGaps ?? []}
        topics={topics}
        documentPages={overview ? documentPageCounts(overview.preparation) : undefined}
        workspaceDocuments={workspaceDocuments}
        timeline={timeline}
      />
    );
  }

  return (
    <HiveHome
      hiveId={hive.id}
      viewer={viewer}
      clientName={hive.kind === "client" ? hive.name : null}
      staffName={hive.assigneeDisplayName?.trim() || null}
      assistantName={assistantName}
      content={content}
      requests={viewer === "staff" ? requests : []}
      loadError={loadError}
      studyLoadError={overview?.studyLoadError ?? null}
      studyAvailability={availability}
      initialPreparation={overview?.preparation}
      conflicts={view?.blocks.find((block) => block.name === "conflicts")?.rows ?? []}
      timeline={timeline}
      timelineReport={resolvedTimeline?.report ?? null}
      legacyHome={legacyHome}
      view={view}
      sources={sources}
      canonicalStudy={canonicalStudy}
      coverageGaps={revision?.coverageGaps ?? []}
      openItems={openItems}
      topics={topics}
      documentPages={overview ? documentPageCounts(overview.preparation) : undefined}
      workspaceDocuments={workspaceDocuments}
      initialPeople={people}
      currentUserId={auth.userId}
      staffView={showsFirmThreePane(hive)}
      viewerIsClient={hive.membershipRole === "client"}
      hiveFirmId={hive.firmId ?? null}
    />
  );
}
