import { AuditTrailPageView } from "@/components/audit/AuditTrailPageView";
import { buildAuditTrailEntries, valuesToSourceRefs } from "@hiveforyou/contracts";
import { requestCorrelationId } from "@/server/auth/action-support";
import { loadHiveBoard } from "@/server/hives/hive-board-loader";
import { documentPageCounts } from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { loadPackById } from "@/server/pipeline/pack-loader";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function AuditPage({ params }: { params: Promise<{ hiveId: string }> }) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/audit`);
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return null;
  const correlationId = await requestCorrelationId();
  const { overview } = await loadHiveBoard(auth.client, { hive, correlationId, userId: auth.userId });
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

  return (
    <>
      <p className="m-0 mb-6 text-meta text-ink-3">
        How HiveForYou reached its findings: each check, its method and result.
      </p>
      <AuditTrailPageView entries={entries} />
    </>
  );
}