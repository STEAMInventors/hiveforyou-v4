import type { HiveBoardModel } from "@hiveforyou/contracts";

import Link from "next/link";

import { DocumentsPanel } from "@/components/hives/DocumentsPanel";
import { HiveBoardChecklistCard } from "@/components/hives/HiveBoardChecklistCard";
import { WORKSPACE_PRIMARY } from "@/components/button-classes";
import { studyDocumentMeta } from "@/components/study/study-summary";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { type HiveOverview, loadHiveOverview } from "@/server/hives/hive-summary";
import { createLiveHiveVaultUploadAdapterDeps } from "@/server/source-documents/hive-vault-upload-adapter";
import { listHiveSourceDocumentsWithV3Vault } from "@/server/source-documents/hive-vault-upload-adapter";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
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
  let requested: HiveBoardModel | null = null;

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
    overview = await loadHiveOverview(auth.client, { hiveId: hive.id, correlationId }).catch(() => null);
    requested = await loadHiveBoard(auth.client, { hive, correlationId, userId: auth.userId })
      .then((loaded) => loaded.board)
      .catch(() => null);
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Link href="#upload" className={WORKSPACE_PRIMARY} data-testid="documents-add-primary">
          Add documents
        </Link>
      </div>
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
        studyView={overview?.studyTab?.view ?? overview?.studyView?.view ?? null}
        canonicalStudy={overview?.canonicalStudy ?? null}
        referencedDocuments={overview?.referencedDocuments ?? []}
        summaryCounts={overview?.summary?.study?.counts ?? null}
        coverageGaps={overview?.preparation?.studyRevision?.coverageGaps ?? []}
      />
      {requested && requested.checklist.length > 0 ? (
        <div className="mt-6" id="requested">
          <HiveBoardChecklistCard board={requested} />
        </div>
      ) : null}
    </>
  );
}