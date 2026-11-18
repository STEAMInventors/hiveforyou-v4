"use client";

import type { HiveBoardModel } from "@hiveforyou/contracts";
import Link from "next/link";

import { WORKSPACE_PRIMARY, WORKSPACE_SECONDARY } from "@/components/button-classes";
import { STATE_LABEL } from "@/components/study/status-state";
import { StatusDot } from "@/components/workspace/StatusDot";
import { Card } from "@/components/workspace/Card";
import { SourceChips } from "@/components/study/SourceChip";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";
import type { useStudyPreparation } from "@/components/hives/useStudyPreparation";

function needKindState(kind: HiveBoardModel["needs"][number]["kind"]): "changed" | "missing" | "needs" {
  if (kind === "conflict") return "changed";
  if (kind === "not_in_study") return "missing";
  return "needs";
}

function BoardNeedAction({
  hiveId,
  action,
  filled,
  rebuildDisabled,
  onRebuild,
}: {
  hiveId: string;
  action: HiveBoardModel["needs"][number]["action"];
  filled: boolean;
  rebuildDisabled: boolean;
  onRebuild: () => void;
}) {
  const className = filled ? WORKSPACE_PRIMARY : WORKSPACE_SECONDARY;
  if (action.kind === "rebuild_study") {
    return (
      <button type="button" className={className} disabled={rebuildDisabled} onClick={onRebuild}>
        {action.label}
      </button>
    );
  }
  const href = action.href ?? `/hives/${hiveId}/documents`;
  if (action.kind === "generate_report") {
    return (
      <Link href={href} className={className}>
        {action.label}
      </Link>
    );
  }
  return (
    <Link href={href} className={className}>
      {action.label}
    </Link>
  );
}

export function HiveBoardNeedRows({
  hiveId,
  board,
  documentLabels,
  analysis,
}: {
  hiveId: string;
  board: HiveBoardModel;
  documentLabels: Readonly<Record<string, string>>;
  analysis: ReturnType<typeof useStudyPreparation>;
}) {
  const labelMap = new Map(Object.entries(documentLabels).map(([id, label]) => [id.toLowerCase(), label]));
  const showPrimary = board.needs.length > 0;
  const rebuildDisabled =
    !analysis.rebuildAvailability?.canRebuild || analysis.starting || analysis.active || !analysis.state;

  const onRebuild = () => {
    analysis.rebuild();
  };

  if (board.needs.length === 0 && !board.next?.action) return null;

<<<<<<< HEAD
  const title = board.needs.length > 0 ? "For your review" : "Next for you";
=======
  const title = board.needs.length > 0 ? `${STATE_LABEL.needs} ${board.needs.length}` : "Next for you";
>>>>>>> origin/main

  return (
    <EvidenceViewerProvider hiveId={hiveId} labels={labelMap} pageCountFor={() => 1} citationContexts={new Map()}>
      <Card
        title={title}
        testId="hive-board-needs-card"
        headerRight={
          board.needs.length > 0 ? (
            <span className="text-caption font-semibold text-graphite">{board.needs.length}</span>
          ) : null
        }
      >
        {board.needs.length > 0 ? (
          <ul className="m-0 flex list-none flex-col p-0">
            {board.needs.map((need, index) => {
<<<<<<< HEAD
              const showKind = need.kindLabel.trim().toLowerCase() !== "to review";
=======
              const showKind = need.kindLabel.trim().toLowerCase() !== STATE_LABEL.needs.toLowerCase();
>>>>>>> origin/main
              return (
                <li
                  key={`${need.kind}-${need.title}-${index}`}
                  className="flex flex-col gap-2 border-t border-line py-3 first:border-0 first:pt-0"
                >
                  {showKind ? <StatusDot state={needKindState(need.kind)} label={need.kindLabel} /> : null}
                  <p className="m-0 text-small font-semibold text-ink">{need.title}</p>
                  <p className="m-0 truncate text-small text-graphite" title={need.detail}>
                    {need.detail}
                  </p>
                  {need.sourceChips.length > 0 ? <SourceChips refs={need.sourceChips} /> : null}
                  <BoardNeedAction
                    hiveId={hiveId}
                    action={need.action}
                    filled={showPrimary && index === 0}
                    rebuildDisabled={rebuildDisabled}
                    onRebuild={onRebuild}
                  />
                </li>
              );
            })}
          </ul>
        ) : board.next?.action ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-small font-semibold text-ink">{board.next.title}</p>
            <p className="m-0 text-small text-graphite">{board.next.detail}</p>
            <BoardNeedAction
              hiveId={hiveId}
              action={board.next.action}
              filled
              rebuildDisabled={rebuildDisabled}
              onRebuild={onRebuild}
            />
          </div>
        ) : null}
      </Card>
    </EvidenceViewerProvider>
  );
}