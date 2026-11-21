import { AuditTrailPageView } from "@/components/audit/AuditTrailPageView";
import { StudyDependentAlerts } from "@/components/hives/StudyDependentAlerts";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { studyAvailability } from "@/lib/hives/study-availability";
import { buildAuditTrailEntries, valuesToSourceRefs } from "@hiveforyou/contracts";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadFirm } from "@/server/firm/load-firm";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { documentPageCounts } from "@/server/hives/hive-summary";
import { loadStudyRevisionHistory } from "@/server/hives/load-study-revision-history";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { loadPackById } from "@/server/pipeline/pack-loader";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function AuditPage({ params }: { params: Promise<{ hiveId: string }> }) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/audit`);
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return null;
  const correlationId = await requestCorrelationId();
  const loaded = await loadHiveBoard(auth.client, { hive, correlationId, userId: auth.userId });
  const firm = await loadFirm(auth.client);
  const assistantName = firm?.firm?.assistantName?.trim() || "HiveForYou";
  const { overview } = loaded;
  const pack =
    overview.canonicalStudy?.packRef != null
      ? loadPackById(overview.canonicalStudy.packRef.id, overview.canonicalStudy.packRef.version)
      : null;

  const studyTab = overview.studyTab;
  const firstPageChips =
    studyTab?.view && studyTab.sources
      ? (overview.canonicalStudy?.documents ?? [])
          .slice(0, 8)
          .flatMap((doc) =>
            valuesToSourceRefs(
              [
                {
                  factId: `page-${doc.sourceDocumentId}`,
                  valueAsWritten: doc.typeInPlainWords,
                  sourceRef: { sourceDocumentId: doc.sourceDocumentId, pageNumber: 1, quote: "" },
                },
              ],
              studyTab.sources,
            ),
          )
      : [];

  const totalPages = Object.values(documentPageCounts(overview.preparation)).reduce((sum, value) => sum + value, 0);
  const readPages = Object.values(documentPageCounts(overview.preparation)).reduce((sum, value) => sum + value, 0);

  const entries =
    overview.studyTab?.view && overview.canonicalStudy
      ? buildAuditTrailEntries({
          view: overview.studyTab.view,
          sources: overview.studyTab.sources,
          canonicalStudy: overview.canonicalStudy,
          pack,
          documentTotal:
            overview.preparation.eligibility.documents.length + overview.preparation.eligibility.excluded.length,
          pagesRead: overview.preparation.eligibility.documents.length > 0 ? readPages : 0,
          pagesTotal: totalPages || overview.preparation.eligibility.documents.length,
          unreadableLabels: overview.preparation.eligibility.excluded
            .filter((item) => item.reason === "UNREADABLE" || item.reason === "READ_FAILED")
            .map((item) => `${item.fileName} · p.unreadable`),
          duplicatePairs: [],
          documentFirstPageChips: firstPageChips,
        })
      : [];

  const revisions = await loadStudyRevisionHistory(auth.client, hive.id);
  const availability = studyAvailability({
    revision: overview.preparation.studyRevision,
    hasCanonicalView: overview.studyTab?.view != null,
    studyLoadError: overview.studyLoadError,
  });

  return (
    <>
      <HivePageHead title="Audit trail" subtitle="How HiveForYou reached its findings: each check, its method and result." />
      {availability.kind !== "canonical" ? <StudyDependentAlerts hiveId={hive.id} overview={overview} /> : null}
      <AuditTrailPageView
        entries={entries}
        revisions={revisions}
        board={loaded.board}
        assistantName={assistantName}
      />
    </>
  );
}