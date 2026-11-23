import Link from "next/link";

import { StudyView } from "@/components/study/StudyView";
import { WorkspaceLoadError } from "@/components/workspace/WorkspaceLoadError";
import { hiveDocumentsPath } from "@/lib/hive-routes";
import { documentPageCounts, loadHiveOverview, workspaceStudyView } from "@/server/hives/hive-summary";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

/** The accepted study for a personal Hive. Firm hives keep this content on Home. */
export async function PersonalFindingsStudy({ hiveId }: { hiveId: string }) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) return null;
  const correlationId = crypto.randomUUID();
  let overview;
  try {
    overview = await loadHiveOverview(auth.client, { hiveId, correlationId });
  } catch {
    return (
      <WorkspaceLoadError
        message="We couldn't load the study for this hive."
        correlationId={correlationId}
        retryable
      />
    );
  }
  const revision = overview.preparation.studyRevision;
  if (!revision) {
    return (
      <section className="mx-auto flex w-full max-w-prose flex-col gap-3" data-testid="personal-study-empty">
        <p className="m-0 text-body text-ink-2">Your study builds once documents are read.</p>
        <Link href={hiveDocumentsPath(hiveId)} className="text-body font-semibold text-blue-deep">
          Go to Documents
        </Link>
      </section>
    );
  }
  const workspace = workspaceStudyView(overview);
  return (
    <StudyView
      hiveId={hiveId}
      revisionFormat={revision.format}
      view={workspace.view}
      sources={workspace.sources}
      revisionNumber={revision.revisionNumber}
      coverageGaps={revision.coverageGaps}
      documentPages={documentPageCounts(overview.preparation)}
    />
  );
}
