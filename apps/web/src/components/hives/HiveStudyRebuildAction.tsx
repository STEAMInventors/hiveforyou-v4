"use client";

import type { GetStudyPreparationResponse } from "@hiveforyou/contracts";
import Link from "next/link";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { useStudyPreparation } from "@/components/hives/useStudyPreparation";
import { hiveDocumentsPath } from "@/lib/hive-routes";

export function HiveStudyRebuildAction({
  hiveId,
  initialPreparation,
  focusDocuments,
}: {
  hiveId: string;
  initialPreparation?: GetStudyPreparationResponse;
  /** When rebuild cannot run here, link to Documents with this hash. */
  focusDocuments?: boolean;
}) {
  const analysis = useStudyPreparation(hiveId, { initialPreparation });
  const canRebuild = analysis.rebuildAvailability?.canRebuild && !analysis.starting && !analysis.active;
  const documentsHref = `${hiveDocumentsPath(hiveId)}${focusDocuments ? "#rebuild-study-button" : ""}`;

  if (!canRebuild) {
    return (
      <Link href={documentsHref} className={WORKSPACE_SECONDARY} data-testid="rebuild-study-link-documents">
        Rebuild the study
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={WORKSPACE_SECONDARY}
      disabled={analysis.starting || analysis.active}
      data-testid="rebuild-study-button-home"
      onClick={() => {
        analysis.returnFocusRef.current = null;
        void analysis.rebuild();
      }}
    >
      Rebuild the study
    </button>
  );
}
