"use client";

import type {
  CanonicalStudy,
  GetStudyPreparationResponse,
  StudyView,
  StudyViewRow,
  StudyViewSources,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useMemo } from "react";

import { FindingsTimelineList } from "@/components/findings/FindingsTimelineList";
import { CanonicalStudyNotice } from "@/components/hives/CanonicalStudyNotice";
import { HiveStudyRebuildAction } from "@/components/hives/HiveStudyRebuildAction";
import { clientHomeOlderStudyLine } from "@/components/home/client-home-model";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";
import { buildHiveEvidenceViewerModel } from "@/components/study/hive-evidence-model";
import { WorkspaceLoadError } from "@/components/workspace/WorkspaceLoadError";
import type { StudyAvailability } from "@/lib/hives/study-availability";
import { hiveDocumentsPath } from "@/lib/hive-routes";
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
  view: StudyView | null;
  sources: StudyViewSources | null;
  canonicalStudy: CanonicalStudy | null;
  documentPages?: Readonly<Record<string, number>>;
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
    return (
      <div data-testid="timeline-older-study">
        {staffView && !viewerIsClient ? (
          <div className="flex flex-col items-start gap-3">
            <CanonicalStudyNotice />
            <HiveStudyRebuildAction hiveId={hiveId} initialPreparation={initialPreparation} focusDocuments />
          </div>
        ) : (
          <p className="m-0 text-[15px] text-ink-2">{clientHomeOlderStudyLine(staffDisplayName)}</p>
        )}
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
      <p className="m-0 mb-4 text-meta text-ink-3">Dated events from the documents, in order. Each row opens its source page.</p>
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
      }),
    [props.view, props.sources, props.canonicalStudy, props.documentPages],
  );

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
        initialPreparation={props.initialPreparation}
      />
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-col-read pt-8 pb-24" data-testid="hive-timeline-panel">
      <h2 className="m-0 font-brand text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">Events in date order</h2>
      {evidence ? (
        <EvidenceViewerProvider
          hiveId={props.hiveId}
          labels={evidence.labels}
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