"use client";

import type { GetStudyPreparationResponse, Hive, HiveBoardModel } from "@hiveforyou/contracts";
import Link from "next/link";

import { AnalyzeModal } from "@/components/hives/AnalyzeModal";
import { HiveBoardChecklistCard } from "@/components/hives/HiveBoardChecklistCard";
import { HiveBoardNeedRows } from "@/components/hives/HiveBoardNeedRows";
import { splitBoardHeadline } from "@/components/hives/hive-board-stage";
import { PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "@/components/button-classes";
import { useStudyPreparation } from "@/components/hives/useStudyPreparation";
import { PaneErrorBoundary } from "@/components/pane-error-boundary";
import { STATE_LABEL } from "@/components/study/status-state";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";
import { SourceChips } from "@/components/study/SourceChip";
import { Card } from "@/components/workspace/Card";

import { HiveBoardPeople } from "@/components/hives/HiveBoardPeople";

type HiveBoardPanelProps = {
  readonly hive: Hive;
  readonly currentUserId: string | null;
  readonly hiveId: string;
  readonly hiveName: string;
  readonly hiveDescription: string;
  readonly hasDocuments: boolean;
  readonly board: HiveBoardModel;
  readonly documentLabels: Readonly<Record<string, string>>;
  readonly initialPreparation?: GetStudyPreparationResponse;
  readonly workspaceMode?: boolean;
};

const SEGMENT_CLASS: Record<"in" | "added_pending" | "not_in", string> = {
  in: "bg-leaf",
  added_pending: "bg-cell-blue",
  not_in: "bg-line",
};

const STATUS_TEXT_CLASS: Record<"in" | "added_pending" | "not_in", string> = {
  in: "text-leaf-deep",
  added_pending: "text-cell-blue-deep",
  not_in: "text-missing-fg",
};

function CircleMark({ status }: { status: "in" | "added_pending" | "not_in" }) {
  if (status === "in") {
    return (
      <span
        aria-hidden
        className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-leaf text-[13px] font-bold text-paper"
      >
        ✓
      </span>
    );
  }
  const outline = status === "added_pending" ? "border-cell-blue" : "border-coral";
  return <span aria-hidden className={`mt-0.5 h-[22px] w-[22px] shrink-0 rounded-full border-2 ${outline} bg-paper`} />;
}

function BoardActionButton({
  action,
  filled,
  onRebuild,
  rebuildDisabled,
}: {
  action: HiveBoardModel["needs"][number]["action"];
  filled: boolean;
  onRebuild: (target: HTMLElement) => void;
  rebuildDisabled: boolean;
}) {
  const className = filled ? PRIMARY_BUTTON_CLASS : QUIET_BUTTON_CLASS;
  if (action.kind === "rebuild_study") {
    return (
      <button
        type="button"
        className={className}
        disabled={rebuildDisabled}
        data-action="rebuild-study"
        onClick={(event) => onRebuild(event.currentTarget)}
      >
        {action.label}
      </button>
    );
  }
  if (action.kind === "generate_report") {
    return (
      <Link href={action.href ?? "#"} className={className} data-action="generate-report">
        {action.label}
      </Link>
    );
  }
  return (
    <Link href={action.href ?? "#"} className={className}>
      {action.label}
    </Link>
  );
}

export function HiveBoardPanel({
  hive,
  currentUserId,
  hiveId,
  hiveName,
  hiveDescription,
  hasDocuments,
  board,
  documentLabels,
  initialPreparation,
  workspaceMode = false,
}: HiveBoardPanelProps) {
  const analysis = useStudyPreparation(hiveId, { initialPreparation });
  const rebuildAvailabilityResolved = analysis.state?.studyRevision
    ? analysis.rebuildAvailability
    : ({ canRebuild: false, reason: "NO_ACCEPTED_STUDY" } as const);
  const rebuildDisabled =
    !rebuildAvailabilityResolved?.canRebuild || analysis.starting || analysis.active || !analysis.state;

  const onRebuild = (target: HTMLElement) => {
    analysis.returnFocusRef.current = target;
    analysis.rebuild();
  };

  const labelMap = new Map(Object.entries(documentLabels).map(([id, label]) => [id.toLowerCase(), label]));
  const showFilledNeeds = board.needs.length > 0;
  const headlineParts = splitBoardHeadline(board.headline);

  if (workspaceMode) {
    return (
      <div className="flex flex-col gap-6 bg-canvas p-4 min-[900px]:flex-row min-[900px]:p-6" data-testid="hive-board-workspace">
        <div className="flex min-w-0 flex-1 flex-col gap-4" data-testid="hive-board-main">
          <h1 className="m-0 font-brand text-section font-semibold leading-tight text-ink">
            {headlineParts.num ? <span className="text-cell-blue-deep">{headlineParts.num}</span> : null}
            {headlineParts.rest}
          </h1>
          <PaneErrorBoundary hiveId={hiveId} supportReference={null}>
            <HiveBoardNeedRows hiveId={hiveId} board={board} documentLabels={documentLabels} analysis={analysis} />
          </PaneErrorBoundary>
          <PaneErrorBoundary hiveId={hiveId} supportReference={null}>
            <HiveBoardChecklistCard board={board} />
          </PaneErrorBoundary>
        </div>
        <aside className="flex w-full flex-col gap-4 min-[900px]:max-w-[340px]" data-testid="hive-board-aside">
          <Card title="At a glance">
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-small">
              {board.readiness.map((line) => (
                <li key={line.label} className="flex items-start justify-between gap-3">
                  <span className="text-graphite">{line.label}</span>
                  <span className="text-end font-semibold text-ink">{line.value}</span>
                </li>
              ))}
            </ul>
          </Card>
          <HiveBoardPeople hive={hive} currentUserId={currentUserId} />
          {hiveDescription ? <p className="m-0 text-small text-graphite">{hiveDescription}</p> : null}
        </aside>
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
      </div>
    );
  }

  return (
    <EvidenceViewerProvider
      hiveId={hiveId}
      labels={labelMap}
      pageCountFor={() => 1}
      citationContexts={new Map()}
    >
      <div className="flex flex-col gap-8 min-[900px]:flex-row min-[900px]:items-start min-[900px]:gap-12">
        <div className="flex min-w-0 max-w-[700px] flex-1 flex-col gap-8" data-testid="hive-board-main">
          <div className="flex flex-col gap-2">
            <p className="m-0 text-small text-graphite">{board.kicker}</p>
            <h2 className="m-0 font-brand text-[30px] font-semibold leading-tight text-ink">{board.headline}</h2>
            {board.progress ? (
              <div className="flex flex-wrap items-center gap-3">
                <div
                  role="img"
                  aria-label={`${board.progress.in} of ${board.progress.total} in`}
                  className="flex min-w-[220px] max-w-[360px] flex-1 gap-1"
                >
                  {board.progress.segments.map((segment, index) => (
                    <span key={`${segment}-${index}`} className={`h-1.5 flex-1 rounded-pill ${SEGMENT_CLASS[segment]}`} />
                  ))}
                </div>
                <span className="text-small text-graphite">
                  {board.progress.in} of {board.progress.total} in
                </span>
              </div>
            ) : null}
          </div>

          {board.needs.length > 0 ? (
            <section className="flex flex-col gap-1" aria-labelledby="hive-board-needs-heading">
              <h3 id="hive-board-needs-heading" className="m-0 mb-1 text-[18px] font-semibold text-cell-blue-deep">
<<<<<<< HEAD
                For your review
=======
                {STATE_LABEL.needs}
>>>>>>> origin/main
              </h3>
              {board.needs.map((need, index) => (
                <div
                  key={`${need.kind}-${need.title}-${index}`}
                  className="flex flex-col gap-1.5 border-t border-line py-3.5 first:border-t-0"
                >
                  {need.kindLabel.trim().toLowerCase() !== "to review" ? (
                    <span className="text-caption font-semibold text-cell-blue-deep">{need.kindLabel}</span>
                  ) : null}
                  <p className="m-0 text-[17px] font-medium leading-snug text-ink">{need.title}</p>
                  <p className="m-0 text-body text-graphite">{need.detail}</p>
                  {need.sourceChips.length > 0 ? (
                    <SourceChips refs={need.sourceChips} />
                  ) : null}
                  <BoardActionButton
                    action={need.action}
                    filled={showFilledNeeds && index === 0}
                    onRebuild={onRebuild}
                    rebuildDisabled={rebuildDisabled}
                  />
                </div>
              ))}
            </section>
          ) : board.next ? (
            <section
              className="flex flex-col gap-3 rounded-card border border-line bg-paper p-6"
              data-testid="hive-board-next"
            >
              <span className="text-small font-semibold text-cell-blue-deep">Next for you</span>
              <h3 className="m-0 font-brand text-[24px] font-semibold leading-snug text-ink">{board.next.title}</h3>
              <p className="m-0 text-body text-graphite">{board.next.detail}</p>
              {board.next.action ? (
                <BoardActionButton
                  action={board.next.action}
                  filled
                  onRebuild={onRebuild}
                  rebuildDisabled={rebuildDisabled}
                />
              ) : null}
            </section>
          ) : null}

          <section className="flex flex-col gap-1" aria-labelledby="hive-board-checklist-heading">
            <h3 id="hive-board-checklist-heading" className="m-0 text-[18px] font-semibold text-ink">
              What this hive needs
            </h3>
            <p className="m-0 pb-1 text-small text-graphite">{board.checklistNote}</p>
            {board.checklist.length === 0 ? (
              <p className="m-0 border-t border-line py-3 text-body text-graphite">
                {hasDocuments
                  ? "Nothing is missing from these records."
                  : "The list appears once the documents are read."}
              </p>
            ) : (
              board.checklist.map((row) => (
                <div key={row.gapId} className="flex gap-3 border-t border-line py-3">
                  <CircleMark status={row.status} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="m-0 text-body font-medium text-ink">{row.title}</p>
                    <p className={`m-0 text-small font-medium ${STATUS_TEXT_CLASS[row.status]}`}>{row.statusText}</p>
                  </div>
                  {row.status === "not_in" ? (
                    <Link href={row.action.href ?? "#"} className={QUIET_BUTTON_CLASS}>
                      {row.action.label}
                    </Link>
                  ) : null}
                </div>
              ))
            )}
          </section>

          <section className="flex flex-col gap-1" aria-labelledby="hive-board-activity-heading">
            <h3 id="hive-board-activity-heading" className="m-0 mb-1 text-[18px] font-semibold text-ink">
              What happened
            </h3>
            {board.activity.length === 0 ? (
              <p className="m-0 text-body text-graphite">Nothing yet.</p>
            ) : (
              board.activity.map((entry) => (
                <div key={`${entry.at}-${entry.text}`} className="flex gap-3 py-2">
                  <span className="w-[118px] shrink-0 pt-0.5 text-caption text-quiet">{entry.atLabel}</span>
                  <p className="m-0 text-body leading-snug">
                    <span className={`font-semibold ${entry.actor === "HiveForYou" ? "text-cell-blue-deep" : "text-ink"}`}>
                      {entry.actor}
                    </span>{" "}
                    {entry.text}
                  </p>
                </div>
              ))
            )}
          </section>
        </div>

        <aside
          className="flex w-full flex-col gap-4 rounded-card border border-line p-6 min-[900px]:max-w-[340px] min-[900px]:flex-1"
          data-testid="hive-board-aside"
        >
          <div className="flex flex-col gap-1">
            <h3 className="m-0 font-brand text-[22px] font-semibold text-ink">{hiveName}</h3>
            {hiveDescription ? <p className="m-0 text-small text-graphite">{hiveDescription}</p> : null}
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-body">
            {board.readiness.map((line) => (
              <li key={line.label} className="flex items-start justify-between gap-3">
                <span className="text-graphite">{line.label}</span>
                <span className="text-end font-semibold text-ink">{line.value}</span>
              </li>
            ))}
          </ul>
          <HiveBoardPeople hive={hive} currentUserId={currentUserId} />
          <div className="border-t border-line pt-4">
            <p className="m-0 text-caption text-graphite">What HiveForYou does here</p>
            <p className="m-0 mt-1 text-small leading-relaxed text-graphite">
              Reads every page, lists what the documents refer to but don&apos;t include, and flags where they disagree. It
              never gives advice; questions about the matter are for you.
            </p>
          </div>
        </aside>
      </div>
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
    </EvidenceViewerProvider>
  );
}