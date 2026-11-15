"use client";

import { useEffect, type ReactNode } from "react";

import { useHiveHeaderWorkspace } from "@/components/app-header";
import { PaneErrorBoundary } from "@/components/pane-error-boundary";
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

export function hiveMetaLine(summary: HiveSummary): string {
  const documents = `${summary.documentCount} ${summary.documentCount === 1 ? "document" : "documents"}`;
  return `${documents} · ${summary.attention.sentence}`;
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
      <h1 className="m-0 break-words font-brand text-[30px] font-semibold leading-tight text-ink">{hiveName}</h1>
      {hiveDescription ? <p className="m-0 max-w-prose text-[16px] text-graphite">{hiveDescription}</p> : null}
      {summary ? (
        <p className="m-0 text-small text-graphite" data-testid="hive-meta">
          {hiveMetaLine(summary)}
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

  return (
    <div className="flex flex-1 flex-col bg-paper">
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
        {activeTab !== "documents" ? (
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
