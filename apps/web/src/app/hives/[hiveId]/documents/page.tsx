import { DocumentsPanel } from "@/components/hives/DocumentsPanel";
import { HiveWorkspaceLayout } from "@/components/hive-workspace-layout";
import { SourceChip } from "@/components/source-chip";
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
  }

  return (
    <HiveWorkspaceLayout
      hiveId={hive.id}
      hiveName={hive.name}
      hiveDescription={hive.description ?? ""}
      activeTab="documents"
    >
      <DocumentsPanel
        hiveId={hive.id}
        initialDocuments={initialDocuments}
        initialError={initialError}
      />
      <SourceChip />
    </HiveWorkspaceLayout>
  );
}
