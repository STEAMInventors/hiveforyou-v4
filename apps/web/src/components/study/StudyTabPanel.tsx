"use client";

import type {
  CoverageGap,
  GetStudyPreparationResponse,
  StudyRevisionFormat,
  StudyView as StudyViewData,
  StudyViewSources,
} from "@hiveforyou/contracts";
import { isActiveProcessingRunStatus } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { AnalyzeModal } from "@/components/hives/AnalyzeModal";
import { DOCUMENT_READ_POLL_INTERVAL_MS } from "@/components/hives/document-read-progress";
import { STUDY_TAB_REBUILD_HINT, rebuildHint } from "@/components/hives/study-preparation-progress";
import { useStudyPreparation } from "@/components/hives/useStudyPreparation";

import { StudyView } from "./StudyView";

type StudyTabPanelProps = {
  hiveId: string;
  revisionFormat: StudyRevisionFormat;
  view: StudyViewData;
  sources: StudyViewSources | null;
  revisionNumber: number;
  coverageGaps?: readonly CoverageGap[];
  documentPages?: Readonly<Record<string, number>>;
  initialPreparation?: GetStudyPreparationResponse;
};

/**
 * Study tab: canonical study layout with Rebuild study beside the revision line and durable
 * preparation progress in the same modal as Documents.
 */
export function StudyTabPanel({
  hiveId,
  revisionFormat,
  view,
  sources,
  revisionNumber,
  coverageGaps,
  documentPages,
  initialPreparation,
}: StudyTabPanelProps) {
  const router = useRouter();
  const analysis = useStudyPreparation(hiveId, { initialPreparation });
  const lastRefreshedRevision = useRef<number | null>(null);

  const hasAcceptedStudy = revisionNumber > 0;
  const rebuildAvailabilityResolved = analysis.state
    ? analysis.state.studyRevision
      ? analysis.rebuildAvailability
      : ({ canRebuild: false, reason: "NO_ACCEPTED_STUDY" } as const)
    : null;
  const rebuildDisabled =
    !rebuildAvailabilityResolved?.canRebuild || analysis.starting || analysis.active || !analysis.state;

  useEffect(() => {
    const run = analysis.run;
    const runActive = !!run && isActiveProcessingRunStatus(run.status);
    if (!runActive) return;
    const timer = setInterval(() => router.refresh(), DOCUMENT_READ_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [analysis.run, router]);

  useEffect(() => {
    const revision = analysis.state?.studyRevision;
    if (
      analysis.run?.preparationMode === "REBUILD" &&
      analysis.run.status === "SUCCEEDED" &&
      revision &&
      revision.processingRunId === analysis.run.id &&
      lastRefreshedRevision.current !== revision.revisionNumber
    ) {
      lastRefreshedRevision.current = revision.revisionNumber;
      router.refresh();
    }
  }, [analysis.run, analysis.state?.studyRevision, router]);

  const revisionActions = hasAcceptedStudy ? (
    <div className="flex min-w-[12rem] flex-col items-stretch gap-1.5 sm:items-end">
      <button
        type="button"
        className={SECONDARY_BUTTON_CLASS}
        disabled={rebuildDisabled}
        data-testid="study-tab-rebuild-button"
        aria-describedby="study-tab-rebuild-hint"
        onClick={(event) => {
          analysis.returnFocusRef.current = event.currentTarget;
          analysis.rebuild();
        }}
      >
        Rebuild study
      </button>
      <p id="study-tab-rebuild-hint" className="m-0 max-w-xs text-caption text-quiet sm:text-end">
        {!analysis.state
          ? "Loading rebuild options…"
          : rebuildAvailabilityResolved?.canRebuild
            ? STUDY_TAB_REBUILD_HINT
            : rebuildHint(rebuildAvailabilityResolved ?? { canRebuild: false, reason: "NO_ACCEPTED_STUDY" })}
      </p>
    </div>
  ) : null;

  return (
    <>
      <StudyView
        hiveId={hiveId}
        revisionFormat={revisionFormat}
        view={view}
        sources={sources}
        revisionNumber={revisionNumber}
        coverageGaps={coverageGaps}
        documentPages={documentPages}
        revisionActions={revisionActions}
      />
      <AnalyzeModal
        hiveId={hiveId}
        mode={analysis.modalMode}
        action={analysis.action}
        run={analysis.run}
        studyRevision={analysis.state?.studyRevision ?? null}
        reportRuns={analysis.reportRuns}
        eligibility={analysis.state?.eligibility ?? null}
        pollState={analysis.pollState}
        starting={analysis.starting}
        startError={analysis.startError}
        returnFocusRef={analysis.returnFocusRef}
        onClose={analysis.closeModal}
        onConfirm={analysis.confirmCoverage}
        onAcknowledge={() => void analysis.acknowledge()}
        onRetry={analysis.retry}
      />
    </>
  );
}
