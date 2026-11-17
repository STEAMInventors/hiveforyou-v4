import Link from "next/link";
import { Suspense } from "react";

import { PaneErrorBoundary } from "@/components/pane-error-boundary";
import { StudyView } from "@/components/study/StudyView";
import { Card } from "@/components/workspace/Card";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { hiveDocumentsPath } from "@/lib/hive-routes";
import { requestCorrelationId } from "@/server/auth/action-support";
import { documentPageCounts, loadHiveOverview } from "@/server/hives/hive-summary";
import { loadOwnedHiveOrNotFound } from "@/server/hives/load-owned-hive";
import { createServerSupabaseClient } from "@/server/supabase/server-client";

export default async function MissingPage({ params }: { params: Promise<{ hiveId: string }> }) {
  const { hiveId } = await params;
  const hive = await loadOwnedHiveOrNotFound(hiveId, `/hives/${hiveId}/missing`);
  const correlationId = await requestCorrelationId();
  const client = await createServerSupabaseClient();
  const overview = await loadHiveOverview(client, { hiveId: hive.id, correlationId, includePreview: true }).catch(
    () => null,
  );
  const revision = overview?.preparation.studyRevision;
  const built = overview?.studyTab;

  return (
    <>
      <HivePageHead
        title="Missing and conflicts"
        subtitle="What the records don't include, and where they disagree."
      />
      {!revision || !built?.view ? (
        <Card title="Your Study builds once documents are read">
          <Link href={hiveDocumentsPath(hive.id)} className={WORKSPACE_SECONDARY}>
            Go to Documents
          </Link>
        </Card>
      ) : (
        <PaneErrorBoundary hiveId={hive.id} supportReference={correlationId}>
          <Suspense fallback={null}>
            <StudyView
              hiveId={hive.id}
              revisionFormat={revision.format}
              view={built.view}
              sources={built.sources}
              revisionNumber={revision.revisionNumber}
              coverageGaps={revision.coverageGaps}
              documentPages={overview ? documentPageCounts(overview.preparation) : undefined}
              workspaceSurface="missing"
            />
          </Suspense>
        </PaneErrorBoundary>
      )}
    </>
  );
}