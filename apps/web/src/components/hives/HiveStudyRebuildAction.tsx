import type { GetStudyPreparationResponse } from "@hiveforyou/contracts";
import Link from "next/link";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { hiveDocumentsPath } from "@/lib/hive-routes";

/**
 * Home and Timeline do not start a rebuild. The Documents page owns the one preparation
 * instance, the progress dialog, and the run.
 */
export function HiveStudyRebuildAction({
  hiveId,
}: {
  hiveId: string;
  initialPreparation?: GetStudyPreparationResponse;
  /** Kept so existing call sites still compile. The link always opens the Documents control. */
  focusDocuments?: boolean;
}) {
  return (
    <Link
      href={`${hiveDocumentsPath(hiveId)}#rebuild-study-button`}
      className={WORKSPACE_SECONDARY}
      data-testid="rebuild-study-link-documents"
    >
      Rebuild the study
    </Link>
  );
}
