"use client";

import type { Hive } from "@hiveforyou/contracts";
import Link from "next/link";
import { useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { statePillText } from "@/components/study/StateBar";
import { DISPLAY_STATES, StatusBadge } from "@/components/study/StatusBadge";
import { hiveDocumentsPath } from "@/lib/hive-routes";
import { isHiveDeletionPending } from "@/lib/hives/hive-deletion-state";
import type { HiveSummary } from "@/server/hives/hive-summary";

import { HiveCardMenu } from "./HiveCardMenu";

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function formatHiveDate(isoTimestamp: string): string | null {
  const parsed = new Date(isoTimestamp);
  return Number.isNaN(parsed.getTime()) ? null : dateFormat.format(parsed);
}

/** The later of the Hive's own update and its accepted study. */
function lastActivity(hive: Hive, summary: HiveSummary | undefined): string | null {
  const candidates = [hive.updatedAt, summary?.study?.acceptedAt].filter((value): value is string => !!value);
  const latest = candidates.reduce<string | null>(
    (best, value) => (best === null || new Date(value).getTime() > new Date(best).getTime() ? value : best),
    null,
  );
  return latest ? formatHiveDate(latest) : null;
}

export function hiveCardMeta(hive: Hive, summary: HiveSummary | undefined): string {
  const parts: string[] = [];
  if (summary) parts.push(`${summary.documentCount} ${summary.documentCount === 1 ? "document" : "documents"}`);
  const activity = lastActivity(hive, summary);
  if (activity) parts.push(`Last activity ${activity}`);
  return parts.join(" · ");
}

function StateSummary({ summary }: { summary: HiveSummary | undefined }) {
  const study = summary?.study ?? null;
  if (!summary) return null;
  if (!study) return <StatusBadge state="neutral" label="No study yet" />;
  const counts = study.counts;
  const shown = counts ? DISPLAY_STATES.filter((state) => counts[state] > 0) : [];
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={`Study revision ${study.revisionNumber}`}>
      <li>
        <StatusBadge state="neutral" label={`Study revision ${study.revisionNumber}`} />
      </li>
      {counts
        ? shown.map((state) => (
            <li key={state}>
              <StatusBadge state={state} label={statePillText(state, counts[state])} />
            </li>
          ))
        : null}
    </ul>
  );
}

type HiveCardGridProps = {
  hives: Hive[];
  summaries?: Readonly<Record<string, HiveSummary>>;
  onRequestDelete: (hive: Hive) => void;
  onRetryDeletion: (hiveId: string) => Promise<void>;
};

const CARD = "relative flex flex-col gap-3 rounded-card border border-line bg-paper p-6 text-ink";

export function HiveCardGrid({ hives, summaries = {}, onRequestDelete, onRetryDeletion }: HiveCardGridProps) {
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
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-5 p-0">
      {hives.map((hive) => {
        if (isHiveDeletionPending(hive)) {
          const retryBusy = retryHiveId === hive.id;
          const retryError = retryErrorByHiveId[hive.id];
          return (
            <li key={hive.id} className={CARD} data-testid="hive-card-deleting">
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
              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="m-0 text-small text-quiet">{hiveCardMeta(hive, undefined)}</p>
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS}
                  disabled={retryBusy}
                  onClick={() => {
                    void handleRetry(hive.id);
                  }}
                >
                  {retryBusy ? "Retrying…" : "Retry deletion"}
                </button>
              </div>
            </li>
          );
        }

        const summary = summaries[hive.id];
        const meta = hiveCardMeta(hive, summary);
        return (
          <li
            key={hive.id}
            className={`${CARD} transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-[0_6px_24px_rgba(31,35,40,0.06)] has-[h2_a:focus-visible]:outline has-[h2_a:focus-visible]:outline-2 has-[h2_a:focus-visible]:outline-offset-2 has-[h2_a:focus-visible]:outline-cell-blue`}
            data-testid="hive-card"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="m-0 min-w-0 flex-1 break-words font-brand text-section font-semibold text-ink">
                <Link
                  href={hiveDocumentsPath(hive.id)}
                  className="text-ink no-underline after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none"
                >
                  {hive.name}
                </Link>
              </h2>
              <div className="relative z-10 -mr-2 -mt-2">
                <HiveCardMenu hiveId={hive.id} hiveName={hive.name} onDeleteHive={() => onRequestDelete(hive)} />
              </div>
            </div>
            {hive.description ? <p className="m-0 line-clamp-2 text-body text-graphite">{hive.description}</p> : null}
            {meta ? <p className="m-0 text-small text-quiet">{meta}</p> : null}
            <div className="mt-auto pt-1">
              <StateSummary summary={summary} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
