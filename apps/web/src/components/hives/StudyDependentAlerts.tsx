import Link from "next/link";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { WorkspaceLoadError } from "@/components/workspace/WorkspaceLoadError";
import { studyAvailability } from "@/lib/hives/study-availability";
import { hiveDocumentsPath } from "@/lib/hive-routes";
import type { HiveOverview } from "@/server/hives/hive-summary";

import { CanonicalStudyNotice } from "./CanonicalStudyNotice";
import { HiveStudyRebuildAction } from "./HiveStudyRebuildAction";

export function StudyDependentAlerts({
  hiveId,
  overview,
}: {
  hiveId: string;
  overview: HiveOverview | null;
}) {
  if (!overview) return null;
  const revision = overview.preparation.studyRevision;
  const availability = studyAvailability({
    revision,
    hasCanonicalView: overview.studyTab?.view != null,
    studyLoadError: overview.studyLoadError,
  });

  if (availability.kind === "load_error") {
    return (
      <div className="mb-6">
        <WorkspaceLoadError
          message={availability.error.message}
          correlationId={availability.error.correlationId}
          retryable={availability.error.retryable}
        />
      </div>
    );
  }

  if (availability.kind === "none") {
    return (
      <div className="mb-6 rounded-card border border-line bg-paper p-6" data-testid="study-dependent-no-study">
        <p className="m-0 font-brand text-section font-semibold text-ink">Your study builds once documents are read.</p>
        <Link href={hiveDocumentsPath(hiveId)} className={`${WORKSPACE_SECONDARY} mt-4`}>
          Go to Documents
        </Link>
      </div>
    );
  }

  if (availability.kind === "older") {
    return (
      <div className="mb-6 flex flex-col items-start gap-3" data-testid="study-dependent-older">
        <CanonicalStudyNotice />
        <HiveStudyRebuildAction
          hiveId={hiveId}
          initialPreparation={overview.preparation}
          focusDocuments
        />
      </div>
    );
  }

  return null;
}
