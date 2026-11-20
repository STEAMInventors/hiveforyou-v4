"use client";

import type { Hive } from "@hiveforyou/contracts";
import { hiveAttention } from "@hiveforyou/contracts";
import Link from "next/link";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { Card } from "@/components/workspace/Card";
import { StatusDot } from "@/components/workspace/StatusDot";
import { hiveHomePath } from "@/lib/hive-routes";
import {
  attentionStatusDots,
  clientHiveMetaLine,
  clientListIntakeDisplay,
} from "@/lib/hives/client-hive-meta";
import { formatWorkspaceActivityDate } from "@/lib/hives/format-workspace-activity";
import { hiveBadgeInitials } from "@/lib/hives/hive-badge-initials";
import type { HiveSummary } from "@/server/hives/hive-summary";

import { HiveCardMenu } from "./HiveCardMenu";

const FALLBACK_ATTENTION = hiveAttention({
  documentCount: 0,
  unreadableDocumentCount: 0,
  documentsNotReadCount: 0,
  activeReadCount: 0,
  processingRunFailed: false,
  processingRunActive: false,
  documentsNotInStudyCount: 0,
  openConflicts: 0,
  openNeeds: 0,
  openChanged: 0,
  openMissing: 0,
  openChecked: 0,
  hasStudy: false,
  hasReport: false,
});

function activityTimestamp(hive: Hive, summary: HiveSummary | undefined): string | null {
  const candidates = [hive.updatedAt, summary?.study?.acceptedAt].filter((value): value is string => !!value);
  const latest = candidates.reduce<string | null>(
    (best, value) => (best === null || new Date(value).getTime() > new Date(best).getTime() ? value : best),
    null,
  );
  return latest ? formatWorkspaceActivityDate(latest) : null;
}

function IntakeSegments({ total, received }: { total: number; received: number }) {
  if (total <= 0) return null;
  return (
    <span className="mb-1 flex gap-[3px]" aria-hidden>
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className={`h-[5px] flex-1 rounded-pill ${index < received ? "bg-leaf" : "bg-line"}`} />
      ))}
    </span>
  );
}

function ClientRow({
  hive,
  summary,
  viewerUserId,
  onRequestDelete,
  onKindChanged,
}: {
  hive: Hive;
  summary: HiveSummary | undefined;
  viewerUserId: string | null;
  onRequestDelete: (hive: Hive) => void;
  onKindChanged: () => void | Promise<void>;
}) {
  const attention = summary?.attention ?? FALLBACK_ATTENTION;
  const meta = clientHiveMetaLine(hive, viewerUserId);
  const intake = clientListIntakeDisplay(summary, attention);
  const activity = activityTimestamp(hive, summary);
  const dots = attentionStatusDots(attention.counts);

  return (
    <li className="list-none border-t border-line first:border-t-0" data-testid="clients-home-row">
      <div className="group relative flex flex-wrap items-start gap-x-4 gap-y-3 px-1 py-3 min-[760px]:grid min-[760px]:grid-cols-[minmax(180px,1.2fr)_minmax(220px,1.6fr)_120px_120px_44px] min-[760px]:items-center">
        <Link
          href={hiveHomePath(hive.id)}
          className="absolute inset-0 z-0 rounded-control group-hover:bg-canvas"
          aria-label={`Open ${hive.name}`}
        />
        <div className="relative z-[1] flex min-w-0 items-start gap-3 pointer-events-none">
          <span
            aria-hidden
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-mist text-caption font-semibold text-graphite"
          >
            {hiveBadgeInitials(hive.name)}
          </span>
          <ClientTextCell name={hive.name} meta={meta} />
        </div>
        <WhereItStandsCell sentence={attention.sentence} dots={dots} />
        <IntakeCell intake={intake} />
        <div className="relative z-[1] ml-auto min-w-[108px] whitespace-nowrap text-right text-small text-quiet pointer-events-none min-[760px]:ml-0">
          {activity ?? "—"}
        </div>
        <div className="relative z-[2] ml-auto min-[760px]:ml-0">
          <HiveCardMenu
            hiveId={hive.id}
            hiveName={hive.name}
            hiveKind={hive.kind}
            triggerClassName={`${WORKSPACE_SECONDARY} !h-11 !w-11 !min-h-11 !px-0`}
            onDeleteHive={() => onRequestDelete(hive)}
            onKindChanged={onKindChanged}
          />
        </div>
      </div>
    </li>
  );
}

function ClientTextCell({ name, meta }: { name: string; meta: string }) {
  return (
    <div className="min-w-0">
      <p className="m-0 truncate text-small font-semibold text-ink">{name}</p>
      {meta ? (
        <p className="m-0 mt-0.5 truncate text-caption text-graphite" title={meta}>
          {meta}
        </p>
      ) : null}
    </div>
  );
}

function WhereItStandsCell({
  sentence,
  dots,
}: {
  sentence: string;
  dots: ReturnType<typeof attentionStatusDots>;
}) {
  return (
    <div className="relative z-[1] min-w-0 pointer-events-none">
      <p className="m-0 text-small text-ink">{sentence}</p>
      <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {dots.map((dot) => (
          <StatusDot key={dot.label} state={dot.state} label={dot.label} />
        ))}
      </p>
    </div>
  );
}

function IntakeCell({
  intake,
}: {
  intake: ReturnType<typeof clientListIntakeDisplay>;
}) {
  return (
    <div className="relative z-[1] min-w-[104px] pointer-events-none">
      <IntakeSegments total={intake.segmentTotal} received={intake.segmentReceived} />
      <span className="text-small text-graphite">{intake.text}</span>
    </div>
  );
}

export function ClientsHomeClientList({
  hives,
  summaries,
  viewerUserId,
  onRequestDelete,
  onKindChanged,
}: {
  hives: Hive[];
  summaries: Readonly<Record<string, HiveSummary>>;
  viewerUserId: string | null;
  onRequestDelete: (hive: Hive) => void;
  onKindChanged: () => void | Promise<void>;
}) {
  return (
    <Card testId="clients-home-list-card" className="px-0 py-0">
      <div className="hidden min-[760px]:grid min-[760px]:grid-cols-[minmax(180px,1.2fr)_minmax(220px,1.6fr)_120px_120px_44px] gap-x-4 border-b border-line px-4 py-3 text-[12.5px] font-semibold text-graphite">
        <span>Client</span>
        <span>Where it stands</span>
        <span>Intake</span>
        <span className="text-right">Last activity</span>
        <span className="sr-only">Actions</span>
      </div>
      <ul className="m-0 px-3 pb-2 pt-1 min-[760px]:px-4">
        {hives.map((hive) => (
          <ClientRow
            key={hive.id}
            hive={hive}
            summary={summaries[hive.id]}
            viewerUserId={viewerUserId}
            onRequestDelete={onRequestDelete}
            onKindChanged={onKindChanged}
          />
        ))}
      </ul>
    </Card>
  );
}