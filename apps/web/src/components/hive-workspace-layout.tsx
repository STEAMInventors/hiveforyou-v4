"use client";

import { useEffect, type ReactNode } from "react";

import { useHiveHeaderWorkspace } from "@/components/app-header";
import { HiveAskInput } from "@/components/hive-ask-input";
import { PaneErrorBoundary } from "@/components/pane-error-boundary";
import { HiveMark } from "@/components/study/HiveMark";
import { StateBar } from "@/components/study/StateBar";
import { hiveStudyPath } from "@/lib/hive-routes";
import type { HiveSummary } from "@/server/hives/hive-summary";

import { type HiveTab, HiveTabNav } from "./hive-tab-nav";

type HiveWorkspaceLayoutProps = {
  hiveId: string;
  hiveName: string;
  hiveDescription: string;
  activeTab: HiveTab;
  /** Null when it could not be loaded; the header then shows only the name. */
  summary: HiveSummary | null;
  /** Shown by the error boundary around the Study and Reports panes. */
  supportReference?: string | null;
  children: ReactNode;
};

const acceptedFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function hiveMetaLine(summary: HiveSummary): string {
  const documents = `${summary.documentCount} ${summary.documentCount === 1 ? "document" : "documents"}`;
  if (!summary.study) return `${documents} · No study yet`;
  const accepted = new Date(summary.study.acceptedAt);
  const when = Number.isNaN(accepted.getTime()) ? "" : `, accepted ${acceptedFormat.format(accepted)}`;
  return `${documents} · Study revision ${summary.study.revisionNumber}${when}`;
}

export function HivePageHeader({
  hiveId,
  hiveName,
  hiveDescription,
  summary,
  onStudyTab,
}: {
  hiveId: string;
  hiveName: string;
  hiveDescription: string;
  summary: HiveSummary | null;
  onStudyTab: boolean;
}) {
  const study = summary?.study ?? null;
  return (
    <header className="flex flex-col gap-2" data-testid="hive-page-header">
      <h1 className="m-0 break-words font-brand text-title font-semibold text-ink">{hiveName}</h1>
      {hiveDescription ? <p className="m-0 max-w-prose text-body text-graphite">{hiveDescription}</p> : null}
      {summary ? (
        <p className="m-0 flex items-center gap-2 text-small text-quiet" data-testid="hive-meta">
          <HiveMark className="h-4 w-4 shrink-0" />
          <span>{hiveMetaLine(summary)}</span>
        </p>
      ) : null}
      {study?.counts && study.targets ? (
        <div className="pt-2">
          <StateBar counts={study.counts} targets={study.targets} hrefBase={onStudyTab ? "" : hiveStudyPath(hiveId)} />
        </div>
      ) : null}
    </header>
  );
}

export function HiveWorkspaceLayout({
  hiveId,
  hiveName,
  hiveDescription,
  activeTab,
  summary,
  supportReference = null,
  children,
}: HiveWorkspaceLayoutProps) {
  const setWorkspace = useHiveHeaderWorkspace()?.setWorkspace;

  useEffect(() => {
    if (!setWorkspace) return;
    setWorkspace({ hiveId, hiveName });
    return () => setWorkspace(null);
  }, [hiveId, hiveName, setWorkspace]);

  const pane = activeTab !== "documents";

  return (
    <div className="flex flex-1 flex-col bg-mist">
      <div className="mx-auto w-full max-w-hive px-6 pt-7">
        <HivePageHeader
          hiveId={hiveId}
          hiveName={hiveName}
          hiveDescription={hiveDescription}
          summary={summary}
          onStudyTab={activeTab === "study"}
        />
        <div className="mt-6">
          <HiveTabNav hiveId={hiveId} active={activeTab} />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-hive flex-col gap-5 px-6 pb-16 pt-6">
        {pane ? <HiveAskInput hiveId={hiveId} /> : null}
        {pane ? (
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
