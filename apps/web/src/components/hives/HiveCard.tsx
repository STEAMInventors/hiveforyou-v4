"use client";

import type { Hive } from "@hiveforyou/contracts";
import Link from "next/link";
import { useState } from "react";

import { SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { hiveDocumentsPath } from "@/lib/hive-routes";
import { isHiveDeletionPending } from "@/lib/hives/hive-deletion-state";

import { HiveCardMenu } from "./HiveCardMenu";

function formatHiveDate(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatHiveActivity(isoTimestamp: string): string {
  const formatted = formatHiveDate(isoTimestamp);
  return formatted === "—" ? "" : `Updated ${formatted}`;
}

function HiveCardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-subtle">{label}</dt>
      <dd className="m-0 mt-0.5 truncate font-medium text-ink">{value}</dd>
    </div>
  );
}

type HiveCardGridProps = {
  hives: Hive[];
  onRequestDelete: (hive: Hive) => void;
  onRetryDeletion: (hiveId: string) => Promise<void>;
};

export function HiveCardGrid({ hives, onRequestDelete, onRetryDeletion }: HiveCardGridProps) {
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
          : "Could not finish deleting this Hive. Try again.";
      setRetryErrorByHiveId((prev) => ({ ...prev, [hiveId]: message }));
    } finally {
      setRetryHiveId(null);
    }
  };

  return (
    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-4 p-0">
      {hives.map((hive) => {
        if (isHiveDeletionPending(hive)) {
          const retryBusy = retryHiveId === hive.id;
          const retryError = retryErrorByHiveId[hive.id];
          return (
            <li
              key={hive.id}
              className="flex min-h-[190px] flex-col justify-between rounded-card border border-coral-wash bg-coral-wash/30 p-6"
            >
              <div>
                <span className="inline-flex rounded-full bg-coral-wash px-2.5 py-1 text-xs font-semibold text-coral-deep">
                  Deletion incomplete
                </span>
                <h2 className="mt-3 m-0 font-brand text-[21px] font-medium text-ink">{hive.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  We could not finish removing this Hive. Retry deletion to clean up files and remove
                  it from your account.
                </p>
                {retryError ? (
                  <p className="mt-3 text-sm text-coral-deep" role="alert">
                    {retryError}
                  </p>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="m-0 text-xs text-ink-subtle">{formatHiveActivity(hive.updatedAt)}</p>
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

        const href = hiveDocumentsPath(hive.id);
        return (
          <li
            key={hive.id}
            className="relative flex flex-col gap-4 rounded-card border border-line bg-paper p-6 text-ink transition-[border-color,box-shadow] hover:border-cell-blue hover:shadow-[0_6px_24px_rgba(31,35,40,0.06)] has-[h2_a:focus-visible]:border-cell-blue has-[h2_a:focus-visible]:outline has-[h2_a:focus-visible]:outline-2 has-[h2_a:focus-visible]:outline-offset-2 has-[h2_a:focus-visible]:outline-cell-blue"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="m-0 text-[12.5px] text-ink-subtle">
                  {formatHiveActivity(hive.updatedAt)}
                </p>
                <h2 className="m-0 break-words font-brand text-[21px] font-medium leading-[1.25] text-ink">
                  <Link
                    href={href}
                    className="text-ink no-underline after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none"
                  >
                    {hive.name}
                  </Link>
                </h2>
                {hive.description ? (
                  <p className="m-0 line-clamp-2 text-[14px] leading-[1.5] text-ink-muted">
                    {hive.description}
                  </p>
                ) : null}
              </div>
              <div className="relative z-10 -mr-2 -mt-2">
                <HiveCardMenu
                  hiveId={hive.id}
                  hiveName={hive.name}
                  onDeleteHive={() => onRequestDelete(hive)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex h-6 items-center rounded-full bg-mist px-2.5 text-[12px] font-medium text-ink-muted">
                No accepted Study yet
              </span>
            </div>
            <dl className="m-0 mt-auto grid grid-cols-3 gap-3 border-t border-line pt-3.5 text-[13px]">
              <HiveCardStat label="Created" value={formatHiveDate(hive.createdAt)} />
              <HiveCardStat label="Study" value="—" />
              <HiveCardStat label="Latest deliverable" value="None yet" />
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
