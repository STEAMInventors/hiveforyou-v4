"use client";

import type {
  CanonicalStudy,
  GetStudyPreparationResponse,
  StudyView,
  StudyViewRow,
  StudyViewSources,
  TimelineReportAttribution,
} from "@hiveforyou/contracts";

import type { HiveWorkspaceDocument } from "@/components/study/hive-evidence-model";
import Link from "next/link";
import { useMemo } from "react";

import { FindingsTimelineList } from "@/components/findings/FindingsTimelineList";
import { CanonicalStudyNotice } from "@/components/hives/CanonicalStudyNotice";
import { HiveStudyRebuildAction } from "@/components/hives/HiveStudyRebuildAction";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";
import { buildHiveEvidenceViewerModel } from "@/components/study/hive-evidence-model";
import { EMPTY_OMNI_CATALOG, useRegisterOmniCatalog } from "@/components/ui/omni-catalog";
import { WorkspaceLoadError } from "@/components/workspace/WorkspaceLoadError";
import type { StudyAvailability } from "@/lib/hives/study-availability";
import {
  legacySavedReportTimelineEmpty,
  legacySavedReportTimelineNotice,
  timelineOlderStudyIdleLine,
} from "@/lib/hives/study-availability";
import { hiveDocumentsPath } from "@/lib/hive-routes";
import {
  mergeOmniCatalog,
  omniDocumentsFromWorkspace,
  omniStatementsFromTimeline,
} from "@/lib/omni-catalog-build";
import type { StudyLoadError } from "@/server/hives/hive-summary";

const SECONDARY_LINK =
  "inline-flex h-[34px] items-center justify-center rounded-button border border-line-strong bg-paper px-[13px] text-[13.5px] font-semibold text-ink no-underline hover:bg-hover max-[759px]:h-11";

export type HiveTimelinePanelProps = {
  hiveId: string;
  staffDisplayName: string | null;
  staffView: boolean;
  viewerIsClient: boolean;
  studyAvailability: StudyAvailability | null;
  studyLoadError: StudyLoadError | null;
  timeline: readonly StudyViewRow[];
  timelineReport?: TimelineReportAttribution | null;
  view: StudyView | null;
  sources: StudyViewSources | null;
  canonicalStudy: CanonicalStudy | null;
  documentPages?: Readonly<Record<string, number>>;
  workspaceDocuments?: readonly HiveWorkspaceDocument[];
  initialPreparation?: GetStudyPreparationResponse;
};

function HiveTimelineBody({
  hiveId,
  staffDisplayName,
  staffView,
  viewerIsClient,
  studyAvailability,
  studyLoadError,
  timeline,
  timelineReport,
  initialPreparation,
}: Pick<
  HiveTimelinePanelProps,
  | "hiveId"
  | "staffDisplayName"
  | "staffView"
  | "viewerIsClient"
  | "studyAvailability"
  | "studyLoadError"
  | "timeline"
  | "timelineReport"
  | "initialPreparation"
>) {
  const olderStudy = studyAvailability?.kind === "older";
  const canonical = studyAvailability?.kind === "canonical";
  const noStudy = studyAvailability?.kind === "none";

  const loadError =
    studyLoadError ??
    (studyAvailability?.kind === "load_error" ? studyAvailability.error : null);
  if (loadError) {
    return (
      <div data-testid="timeline-study-error">
        <WorkspaceLoadError message={loadError.message} correlationId={loadError.correlationId} retryable={loadError.retryable} />
      </div>
    );
  }

  if (noStudy) {
    return (
      <div data-testid="timeline-no-study">
        <p className="m-0 max-w-[640px] font-brand text-[20px] font-medium leading-[1.35] tracking-[-0.02em] text-ink">
          Your study builds once documents are read.
        </p>
        <Link href={hiveDocumentsPath(hiveId)} className={`${SECONDARY_LINK} mt-4`}>
          Go to Documents
        </Link>
      </div>
    );
  }

  if (olderStudy) {
    const revisionNumber = studyAvailability.revisionNumber;
    const staffRebuild = staffView && !viewerIsClient ? (
      <div className="mb-4 flex flex-col items-start gap-3">
        <CanonicalStudyNotice />
        <HiveStudyRebuildAction hiveId={hiveId} initialPreparation={initialPreparation} focusDocuments />
      </div>
    ) : null;
    const idleLine = timelineOlderStudyIdleLine({ staffView, viewerIsClient, staffDisplayName });

    if (timeline.length > 0) {
      return (
        <div data-testid="timeline-legacy-events">
          <p
            className="m-0 mb-4 text-meta text-ink-3"
            data-testid="timeline-legacy-notice"
            data-report-id={timelineReport?.reportId}
            data-historical={timelineReport?.fromHistory ? "true" : undefined}
          >
            {legacySavedReportTimelineNotice(revisionNumber, timelineReport)}
          </p>
          {staffRebuild}
          {!staffView && !viewerIsClient && idleLine ? (
            <p className="m-0 mb-4 text-[15px] text-ink-2" data-testid="timeline-older-own-hive">
              {idleLine}
            </p>
          ) : null}
          <p className="m-0 mb-4 text-meta text-ink-3">Each row opens its source page from the saved report.</p>
          <FindingsTimelineList rows={timeline} />
        </div>
      );
    }

    return (
      <div data-testid="timeline-older-study">
        {staffRebuild}
        {viewerIsClient && idleLine ? (
          <p className="m-0 mb-3 text-[15px] text-ink-2" data-testid="timeline-older-client">
            {idleLine}
          </p>
        ) : null}
        {!staffView && !viewerIsClient && idleLine ? (
          <p className="m-0 mb-3 text-[15px] text-ink-2" data-testid="timeline-older-own-hive">
            {idleLine}
          </p>
        ) : null}
        <p className="m-0 py-3.5 text-body text-ink-2" data-testid="timeline-empty">
          {legacySavedReportTimelineEmpty(revisionNumber)}
        </p>
      </div>
    );
  }

  if (!canonical) return null;

  if (timeline.length === 0) {
    return (
      <p className="m-0 py-3.5 text-body text-ink-2" data-testid="timeline-empty">
        No dated events in this study yet.
      </p>
    );
  }

  return (
    <div data-testid="timeline-events">
      <FindingsTimelineList rows={timeline} />
    </div>
  );
}

export function HiveTimelinePanel(props: HiveTimelinePanelProps) {
  const evidence = useMemo(
    () =>
      buildHiveEvidenceViewerModel({
        view: props.view,
        sources: props.sources,
        canonicalStudy: props.canonicalStudy,
        documentPages: props.documentPages,
        projectedTimeline: props.view ? undefined : props.timeline,
        workspaceDocuments: props.workspaceDocuments,
      }),
    [props.view, props.sources, props.canonicalStudy, props.documentPages, props.timeline, props.workspaceDocuments],
  );
  const studyDocumentRows = useMemo(
    () => props.view?.blocks.find((block) => block.name === "documents")?.rows ?? [],
    [props.view],
  );
  const omniCatalog = useMemo(
    () =>
      mergeOmniCatalog({
        suggestions: EMPTY_OMNI_CATALOG.suggestions,
        openItems: EMPTY_OMNI_CATALOG.openItems,
        documents: omniDocumentsFromWorkspace({
          workspaceDocuments: props.workspaceDocuments,
          studyDocumentRows,
          documentPages: props.documentPages,
          sourcesDocuments: props.sources?.documents,
        }),
        statements: omniStatementsFromTimeline(props.timeline),
      }),
    [props.documentPages, props.sources?.documents, props.timeline, props.workspaceDocuments, studyDocumentRows],
  );
  useRegisterOmniCatalog(omniCatalog);

  const body = (
    <div className="mt-6">
      <HiveTimelineBody
        hiveId={props.hiveId}
        staffDisplayName={props.staffDisplayName}
        staffView={props.staffView}
        viewerIsClient={props.viewerIsClient}
        studyAvailability={props.studyAvailability}
        studyLoadError={props.studyLoadError}
        timeline={props.timeline}
        timelineReport={props.timelineReport}
        initialPreparation={props.initialPreparation}
      />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-col-read pb-24" data-testid="hive-timeline-panel">
      <header className="rounded-[12px] border border-line bg-mist px-4 py-3">
        <h2 className="m-0 font-brand text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Events in date order
        </h2>
        <p className="m-0 mt-1 text-meta text-ink-2">Dated events from the documents. Each row opens its source page.</p>
      </header>
      {evidence ? (
        <EvidenceViewerProvider
          hiveId={props.hiveId}
          labels={evidence.labels}
          chipLabels={evidence.chipLabels}
          pageCountFor={evidence.pageCountFor}
          citationContexts={evidence.citationContexts}
        >
          {body}
        </EvidenceViewerProvider>
      ) : (
        body
      )}
    </div>
  );
}