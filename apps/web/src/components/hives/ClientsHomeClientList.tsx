"use client";

import type { Hive } from "@hiveforyou/contracts";
import { hiveAttention } from "@hiveforyou/contracts";
import Link from "next/link";

import { StatusDot } from "@/components/ui/StatusDot";
import { hiveHomePath } from "@/lib/hive-routes";
import { clientHiveMetaLine } from "@/lib/hives/client-hive-meta";
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

function hivePurpose(hive: Hive): string | null {
  return hive.description?.trim() || hive.homeKicker?.split(" · ")[0]?.trim() || null;
}

function docsMeta(summary: HiveSummary | undefined): string {
  const count = summary?.documentCount ?? 0;
  const rev = summary?.study?.revisionNumber;
  const docs = count === 1 ? "1 document" : `${count} documents`;
  if (rev != null) {
    return `${docs} · Study v${rev}`;
  }
  return docs;
}

function reviewStatus(summary: HiveSummary | undefined): { state: "needs" | "checked"; label: string } {
  const attention = summary?.attention ?? FALLBACK_ATTENTION;
  const open = (attention.counts.needs ?? 0) + (attention.counts.missing ?? 0) + (attention.counts.changed ?? 0);
  if (open > 0) {
    return { state: "needs", label: `${open} to review` };
  }
  return { state: "checked", label: "Up to date" };
}

function ClientRow({
  hive,
  summary,
  onRequestDelete,
  onKindChanged,
  viewerUserId,
}: {
  hive: Hive;
  summary: HiveSummary | undefined;
  viewerUserId: string | null;
  onRequestDelete: (hive: Hive) => void;
  onKindChanged: () => void | Promise<void>;
}) {
  const purpose = clientHiveMetaLine(hive, viewerUserId) || hivePurpose(hive);
  const status = reviewStatus(summary);

  return (
    <li className="list-none border-b border-line py-3.5 first:pt-0" data-testid="clients-home-row">
      <div className="flex items-start gap-3">
        <Link
          href={hiveHomePath(hive.id)}
          className="flex min-w-0 flex-1 items-start gap-3 no-underline hover:opacity-95"
        >
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-button bg-mist text-caption font-semibold text-ink-2"
          >
            {hiveBadgeInitials(hive.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body font-semibold text-ink">{hive.name}</span>
            {purpose ? <span className="mt-0.5 block text-meta text-ink-3">{purpose}</span> : null}
            <span className="mt-1 block text-meta text-ink-3">{docsMeta(summary)}</span>
            <span className="mt-1.5 inline-flex">
              <StatusDot state={status.state} label={status.label} />
            </span>
          </span>
        </Link>
        <HiveCardMenu
          hiveId={hive.id}
          hiveName={hive.name}
          hiveKind={hive.kind}
          onDeleteHive={() => onRequestDelete(hive)}
          onKindChanged={onKindChanged}
        />
      </div>
    </li>
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
    <ul className="m-0 flex list-none flex-col gap-0 p-0" data-testid="clients-home-list">
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
  );
}