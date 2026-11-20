import {
  buildFindingsOpenItems,
  buildFindingsTopics,
} from "@hiveforyou/contracts";

import { DocumentsPanel } from "@/components/hives/DocumentsPanel";
import { studyDocumentMeta } from "@/components/study/study-summary";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { type HiveOverview, loadHiveOverview } from "@/server/hives/hive-summary";
import { createLiveHiveVaultUploadAdapterDeps } from "@/server/source-documents/hive-vault-upload-adapter";
import { listHiveSourceDocumentsWithV3Vault } from "@/server/source-documents/hive-vault-upload-adapter";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { loadPackById } from "@/server/pipeline/pack-loader";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type DocumentsPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function DocumentsPage({ params }: DocumentsPageProps) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/documents`);

  let initialDocuments: Awaited<
    ReturnType<typeof listHiveSourceDocumentsWithV3Vault>
  >["sourceDocuments"] = [];
  let initialError: { message: string; correlationId: string | null } | null = null;
  let overview: HiveOverview | null = null;
  let checklist: Awaited<ReturnType<typeof loadHiveBoard>>["board"]["checklist"] = [];

  const auth = await requireAuthenticatedUser();
  if (auth.ok) {
    const correlationId = crypto.randomUUID();
    try {
      const deps = createLiveHiveVaultUploadAdapterDeps(auth.client, correlationId);
      const listed = await listHiveSourceDocumentsWithV3Vault(deps, {
        ownerUserId: auth.userId,
        hiveId: hive.id,
        correlationId,
      });
      initialDocuments = listed.sourceDocuments;
    } catch {
      initialError = {
        message: "Could not load your documents.",
        correlationId: null,
      };
    }

    try {
      const boardLoad = await loadHiveBoard(auth.client, { hive, correlationId, userId: auth.userId });
      overview = boardLoad.overview;
      checklist = boardLoad.board.checklist;
    } catch {
      overview = await loadHiveOverview(auth.client, { hiveId: hive.id, correlationId }).catch(() => null);
    }
  }

  const view = overview?.studyTab?.view ?? overview?.studyView?.view ?? null;
  const sources = overview?.studyTab?.sources ?? null;
  const canonicalStudy = overview?.canonicalStudy ?? null;
  const pack =
    canonicalStudy?.packRef != null
      ? loadPackById(canonicalStudy.packRef.id, canonicalStudy.packRef.version)
      : null;
  const openItems = view ? buildFindingsOpenItems(view, canonicalStudy) : [];
  const topics = view ? buildFindingsTopics({ view, canonicalStudy, pack, openItems }).topics : [];

  return (
    <DocumentsPanel
      hiveId={hive.id}
      initialDocuments={initialDocuments}
      initialError={initialError}
      documentMeta={
        overview?.studyTab?.view
          ? studyDocumentMeta(overview.studyTab.view)
          : overview?.studyView
            ? studyDocumentMeta(overview.studyView.view)
            : undefined
      }
      studyView={view}
      sources={sources}
      canonicalStudy={canonicalStudy}
      referencedDocuments={overview?.referencedDocuments ?? []}
      coverageGaps={overview?.preparation?.studyRevision?.coverageGaps ?? []}
      checklist={checklist}
      openItems={openItems}
      topics={topics}
    />
  );
}