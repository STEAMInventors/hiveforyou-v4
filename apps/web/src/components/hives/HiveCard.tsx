"use client";

import type { Hive, HiveAttentionResult } from "@hiveforyou/contracts";
import { hiveAttention } from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { StatusBadge } from "@/components/study/StatusBadge";
import { hivePath } from "@/lib/hive-routes";
import { formatStateLineParts } from "@/lib/hives/state-line";
import { isHiveDeletionPending } from "@/lib/hives/hive-deletion-state";
import type { HiveSummary } from "@/server/hives/hive-summary";

import { HiveCardMenu } from "./HiveCardMenu";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatHiveDate(isoTimestamp: string): string | null {
  const parsed = new Date(isoTimestamp);
  return Number.isNaN(parsed.getTime()) ? null : dateFormat.format(parsed);
}

function lastActivity(hive: Hive, summary: HiveSummary | undefined): string | null {
  const candidates = [hive.updatedAt, summary?.study?.acceptedAt].filter((value): value is string => !!value);
  const latest = candidates.reduce<string | null>(
    (best, value) => (best === null || new Date(value).getTime() > new Date(best).getTime() ? value : best),
    null,
  );
  return latest ? formatHiveDate(latest) : null;
}

const FALLBACK_ATTENTION: HiveAttentionResult = hiveAttention({
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

type HiveListProps = {
  hives: Hive[];
  summaries?: Readonly<Record<string, HiveSummary>>;
  showColumnHeaders?: boolean;
  onRequestDelete: (hive: Hive) => void;
  onRetryDeletion: (hiveId: string) => Promise<void>;
  onKindChanged: () => void | Promise<void>;
};

function hiveKicker(hive: Hive): string | null {
  if (hive.homeKicker) {
    return hive.homeKicker;
  }
  if (hive.kind === "own") {
    return "Your own matter";
  }
  if (hive.membershipRole === "client" && hive.isOwner !== true && hive.ownerDisplayName) {
    return `Your hive with ${hive.ownerDisplayName}`;
  }
  const description = hive.description?.trim();
  return description || null;
}

function intakeLabel(summary: HiveSummary | undefined, attention: HiveAttentionResult): string {
  const documentCount = summary?.documentCount ?? 0;
  const intake = summary?.intake ?? { total: 0, received: 0 };
  if (documentCount === 0) {
    return "No documents yet";
  }
  if (intake.total === 0 && attention.counts.missing === 0) {
    return "Nothing missing";
  }
  if (intake.total > 0) {
    return `${intake.received} of ${intake.total} in`;
  }
  return "Nothing missing";
}

function IntakeSegments({ summary }: { summary: HiveSummary | undefined }) {
  const documentCount = summary?.documentCount ?? 0;
  const intake = summary?.intake ?? { total: 0, received: 0 };
  const total = intake.total > 0 ? intake.total : documentCount > 0 ? 1 : 0;
  const received = intake.total > 0 ? intake.received : documentCount > 0 ? 1 : 0;
  if (total === 0) {
    return null;
  }
  return (
    <span className="flex gap-[3px]" role="img" aria-label={intakeLabel(summary, summary?.attention ?? FALLBACK_ATTENTION)}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={`h-[5px] flex-1 rounded-pill ${index < received ? "bg-leaf" : "bg-line"}`}
        />
      ))}
    </span>
  );
}

function JoinHiveButton({ hiveId }: { hiveId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/hives/${hiveId}/membership`, { method: "POST" });
      if (!response.ok) {
        setError("Could not join this hive. Try again.");
        return;
      }
      router.push(hivePath(hiveId));
      router.refresh();
    } catch {
      setError("Could not join this hive. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      <button type="button" className={`${SECONDARY_BUTTON_CLASS} min-h-11`} disabled={busy} onClick={() => void join()}>
        {busy ? "Joining…" : "Join this hive"}
      </button>
      {error ? (
        <p className="m-0 mt-1 text-small text-coral-deep" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function HiveRow({
  hive,
  summary,
  onRequestDelete,
  onKindChanged,
}: {
  hive: Hive;
  summary: HiveSummary | undefined;
  onRequestDelete: (hive: Hive) => void;
  onKindChanged: () => void | Promise<void>;
}) {
  const attention = summary?.attention ?? FALLBACK_ATTENTION;
  const activity = lastActivity(hive, summary);
  const kicker = hiveKicker(hive);
  const stateParts = formatStateLineParts(attention.counts);
  const pendingJoin = hive.membershipRole === "professional" && hive.memberState === "pending";

  return (
    <li
      className="group border-b border-line last:border-b-0"
      data-testid="hive-list-row"
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-3 py-4 min-[760px]:flex-nowrap min-[760px]:gap-x-5">
        <div className="min-w-0 flex-1 basis-[200px]">
          {pendingJoin ? (
            <div className="-mx-2 px-2 py-1">
              <p className="m-0 text-[17px] font-semibold text-ink">{hive.name}</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink-2">Accepted the invite, not joined yet</p>
              <JoinHiveButton hiveId={hive.id} />
            </div>
          ) : (
          <Link href={hivePath(hive.id)} className="block rounded-control no-underline hover:bg-mist group-hover:bg-mist -mx-2 px-2 py-1">
            <p className="m-0 text-[17px] font-semibold text-blue-deep">{hive.name}</p>
            {kicker ? <p className="m-0 mt-0.5 text-[13px] text-ink-2">{kicker}</p> : null}
          </Link>
          )}
        </div>
        <div className="min-w-0 flex-[2] basis-[260px]">
          <p className="m-0 text-[15px] leading-relaxed text-ink">{attention.sentence}</p>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold">
            {stateParts.map((part) => (
              <span key={part.key} className={part.className}>
                {part.label}
              </span>
            ))}
          </p>
        </div>
        <div className="flex min-w-[150px] flex-col gap-1.5 basis-[150px]">
          <IntakeSegments summary={summary} />
          <span className="text-[13px] text-ink-2">{intakeLabel(summary, attention)}</span>
        </div>
        <div className="ml-auto flex min-w-[110px] items-start gap-2 basis-[110px] min-[760px]:ml-0">
          {activity ? (
            <span className="flex-1 text-right text-[13px] text-ink-3 min-[760px]:block">{activity}</span>
          ) : (
            <span className="flex-1" />
          )}
          <HiveCardMenu
            hiveId={hive.id}
            hiveName={hive.name}
            hiveKind={hive.kind}
            onDeleteHive={() => onRequestDelete(hive)}
            onKindChanged={onKindChanged}
          />
        </div>
      </div>
    </li>
  );
}

export function HiveList({
  hives,
  summaries = {},
  showColumnHeaders = false,
  onRequestDelete,
  onRetryDeletion,
  onKindChanged,
}: HiveListProps) {
  const [retryHiveId, setRetryHiveId] = useState<string | null>(null);
  const [retryErrorByHiveId, setRetryErrorByHiveId] = useState<Record<string, string>>({});

  const handleRetry = async (hiveId: string) => {
    setRetryHiveId(hiveId);
    setRetryErrorByHiveId((prev) => {
      const next = { ...prev };
      delete next[hiveId];
      return next;
    });
    try {
      await onRetryDeletion(hiveId);
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : "We couldn't finish deleting this hive. Try again.";
      setRetryErrorByHiveId((prev) => ({ ...prev, [hiveId]: message }));
    } finally {
      setRetryHiveId(null);
    }
  };

  return (
    <div className="w-full">
      {showColumnHeaders ? (
        <div
          className="hidden min-[760px]:flex gap-5 border-b border-line px-3 pb-2 pt-4 text-[13px] font-semibold text-ink-3"
          data-testid="hive-list-column-headers"
        >
          <span className="min-w-0 flex-1 basis-[200px]">Client</span>
          <span className="min-w-0 flex-[2] basis-[260px]">Where it stands</span>
          <span className="w-[150px] shrink-0">Intake</span>
          <span className="w-[110px] shrink-0 text-right">Last activity</span>
        </div>
      ) : null}
      <ul className="m-0 list-none p-0">
        {hives.map((hive) => {
          if (isHiveDeletionPending(hive)) {
            const retryBusy = retryHiveId === hive.id;
            const retryError = retryErrorByHiveId[hive.id];
            return (
              <li key={hive.id} className="flex flex-col gap-2 border-b border-line px-3 py-4" data-testid="hive-card-deleting">
                <StatusBadge state="missing" label="Deletion incomplete" />
                <h2 className="m-0 break-words font-brand text-section font-semibold text-ink">{hive.name}</h2>
                <p className="m-0 text-body text-ink-2">
                  We couldn&apos;t finish deleting this hive. Try again to remove its files and take it off your list.
                </p>
                {retryError ? (
                  <p className="m-0 text-small text-missing-fg" role="alert">
                    {retryError}
                  </p>
                ) : null}
                <button
                  type="button"
                  className={`${SECONDARY_BUTTON_CLASS} self-start`}
                  disabled={retryBusy}
                  onClick={() => void handleRetry(hive.id)}
                >
                  {retryBusy ? "Retrying…" : "Retry deletion"}
                </button>
              </li>
            );
          }

          return (
            <HiveRow
              key={hive.id}
              hive={hive}
              summary={summaries[hive.id]}
              onRequestDelete={onRequestDelete}
              onKindChanged={onKindChanged}
            />
          );
        })}
      </ul>
    </div>
  );
}