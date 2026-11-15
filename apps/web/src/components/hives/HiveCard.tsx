"use client";

import type { Hive, HiveAttentionResult } from "@hiveforyou/contracts";
import { hiveAttention } from "@hiveforyou/contracts";
import Link from "next/link";
import { useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { StatusBadge } from "@/components/study/StatusBadge";
import { hiveDocumentsPath } from "@/lib/hive-routes";
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
  startingView: "own" | "clients";
  onRequestDelete: (hive: Hive) => void;
  onRetryDeletion: (hiveId: string) => Promise<void>;
  onKindChanged: () => void | Promise<void>;
};

type HiveRowProps = {
  hive: Hive;
  summary: HiveSummary | undefined;
  startingView: "own" | "clients";
  onRequestDelete: (hive: Hive) => void;
  onKindChanged: () => void | Promise<void>;
};

function HiveRow({ hive, summary, startingView, onRequestDelete, onKindChanged }: HiveRowProps) {
  const attention = summary?.attention ?? FALLBACK_ATTENTION;
  const activity = lastActivity(hive, summary);
  const kicker =
    startingView === "clients"
      ? hive.description?.trim() || "Client hive"
      : "Your hive";
  const stateParts = formatStateLineParts(attention.counts);

  return (
    <li className="relative flex flex-col gap-0.5 py-0" data-testid="hive-list-row">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13px] text-graphite">{kicker}</p>
          <h2 className="m-0 mt-0.5 text-[20px] font-medium leading-snug">
            <Link
              href={hiveDocumentsPath(hive.id)}
              className="text-cell-blue-deep no-underline hover:underline"
            >
              {hive.name}
            </Link>
          </h2>
        </div>
        <HiveCardMenu
          hiveId={hive.id}
          hiveName={hive.name}
          hiveKind={hive.kind}
          onDeleteHive={() => onRequestDelete(hive)}
          onKindChanged={onKindChanged}
        />
      </div>
      <p className="m-0 text-[15px] leading-relaxed text-ink">{attention.sentence}</p>
      <p className="m-0 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13.5px]">
        {stateParts.map((part) => (
          <span key={part.key} className={`font-semibold ${part.className}`}>
            {part.label}
          </span>
        ))}
        {activity ? <span className="font-normal text-quiet">Last activity {activity}</span> : null}
      </p>
    </li>
  );
}

export function HiveList({
  hives,
  summaries = {},
  startingView,
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
    <ul className="m-0 flex list-none flex-col gap-7 p-0">
      {hives.map((hive) => {
        if (isHiveDeletionPending(hive)) {
          const retryBusy = retryHiveId === hive.id;
          const retryError = retryErrorByHiveId[hive.id];
          return (
            <li key={hive.id} className="flex flex-col gap-2" data-testid="hive-card-deleting">
              <StatusBadge state="missing" label="Deletion incomplete" />
              <h2 className="m-0 break-words font-brand text-section font-semibold text-ink">{hive.name}</h2>
              <p className="m-0 text-body text-graphite">
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
            startingView={startingView}
            onRequestDelete={onRequestDelete}
            onKindChanged={onKindChanged}
          />
        );
      })}
    </ul>
  );
}