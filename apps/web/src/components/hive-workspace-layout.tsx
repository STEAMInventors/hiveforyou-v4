"use client";

import type { HiveKind } from "@hiveforyou/contracts";
import Link from "next/link";
import { useEffect, useMemo, type ReactNode } from "react";

import { useHiveHeaderWorkspace } from "@/components/app-header";
import { PaneErrorBoundary } from "@/components/pane-error-boundary";
import { StateBar, type StateCounts } from "@/components/study/StateBar";
import type { StartingView } from "@/lib/auth/profile";
import { hiveListBackLink } from "@/lib/hives/hive-list-back";
import { hiveStudyPath } from "@/lib/hive-routes";
import type { HiveSummary } from "@/server/hives/hive-summary";

import { type HiveTab, HiveTabNav } from "./hive-tab-nav";

type HiveWorkspaceLayoutProps = {
  hiveId: string;
  hiveName: string;
  hiveDescription: string;
  hiveKind: HiveKind;
  startingView: StartingView;
  activeTab: HiveTab;
  /** Null when it could not be loaded; the header then shows only the name. */
  summary: HiveSummary | null;
  /** Shown by the error boundary around the Study and Reports panes. */
  supportReference?: string | null;
  /** Firm client board fills the width under the tabs. */
  flushBoard?: boolean;
  children: ReactNode;
};

export function hiveMetaLine(summary: HiveSummary): string {
  const documents = `${summary.documentCount} ${summary.documentCount === 1 ? "document" : "documents"}`;
  return `${documents} · ${summary.attention.sentence}`;
}

function stateBarCounts(
  counts: StateCounts,
  options: { hideMissingChip: boolean },
): StateCounts | null {
  const adjusted = options.hideMissingChip ? { ...counts, missing: 0 } : counts;
  if (adjusted.needs === 0 && adjusted.changed === 0 && adjusted.missing === 0 && adjusted.checked === 0) {
    return null;
  }
  return adjusted;
}

export function HivePageHeader({
  hiveId,
  hiveName,
  hiveDescription,
  hiveKind,
  startingView,
  summary,
  onStudyTab,
  hideMissingChip = false,
}: {
  hiveId: string;
  hiveName: string;
  hiveDescription: string;
  hiveKind: HiveKind;
  startingView: StartingView;
  summary: HiveSummary | null;
  onStudyTab: boolean;
  hideMissingChip?: boolean;
}) {
  const study = summary?.study ?? null;
  const back = hiveListBackLink(startingView, hiveKind);
  const barCounts = useMemo(
    () => (study?.counts && study.targets ? stateBarCounts(study.counts, { hideMissingChip }) : null),
    [hideMissingChip, study?.counts, study?.targets],
  );
  return (
    <header className="flex flex-col gap-2" data-testid="hive-page-header">
      <Link
        href={back.href}
        className="inline-flex min-h-11 w-fit items-center gap-1 text-small text-graphite no-underline hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cell-blue"
        data-testid="hive-list-back"
      >
        <span aria-hidden>←</span>
        {back.label}
      </Link>
      <h1 className="m-0 break-words font-brand text-[30px] font-semibold leading-tight text-ink">{hiveName}</h1>
      {hiveDescription ? <p className="m-0 max-w-prose text-[16px] text-graphite">{hiveDescription}</p> : null}
      {summary ? (
        <p className="m-0 text-small text-graphite" data-testid="hive-meta">
          {hiveMetaLine(summary)}
        </p>
      ) : null}
      {barCounts && study?.targets ? (
        <div className="pt-2">
          <StateBar counts={barCounts} targets={study.targets} hrefBase={onStudyTab ? "" : hiveStudyPath(hiveId)} />
        </div>
      ) : null}
    </header>
  );
}

export function HiveWorkspaceLayout({
  hiveId,
  hiveName,
  hiveDescription,
  hiveKind,
  startingView,
  activeTab,
  summary,
  supportReference = null,
  flushBoard = false,
  children,
}: HiveWorkspaceLayoutProps) {
  const setWorkspace = useHiveHeaderWorkspace()?.setWorkspace;

  useEffect(() => {
    if (!setWorkspace) return;
    setWorkspace({ hiveId, hiveName });
    return () => setWorkspace(null);
  }, [hiveId, hiveName, setWorkspace]);

  return (
    <div className="flex flex-1 flex-col bg-paper">
      <div className="mx-auto w-full max-w-hive px-6 pt-7">
        <HivePageHeader
          hiveId={hiveId}
          hiveName={hiveName}
          hiveDescription={hiveDescription}
          hiveKind={hiveKind}
          startingView={startingView}
          summary={summary}
          onStudyTab={activeTab === "study"}
          hideMissingChip={activeTab === "board"}
        />
        <div className="mt-6">
          <HiveTabNav hiveId={hiveId} active={activeTab} />
        </div>
      </div>

      <div className={flushBoard ? "flex w-full flex-1 flex-col" : "mx-auto flex w-full max-w-hive flex-col gap-5 px-6 pb-16 pt-6"}>
        {activeTab !== "documents" && activeTab !== "board" ? (
          <PaneErrorBoundary hiveId={hiveId} supportReference={supportReference}>
            {children}
          </PaneErrorBoundary>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
