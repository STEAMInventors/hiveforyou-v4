"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { HiveBrandMark } from "@/components/HiveWordmark";
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/button-classes";
import { loadGuestDraft } from "@/lib/guest-draft";
import { HiveClientError, fetchMyHives } from "@/lib/hives-client";
import { MY_HIVES_PATH, hiveDocumentsPath } from "@/lib/hive-routes";

import { CreateHiveModal } from "./CreateHiveModal";
import { HiveCardGrid } from "./HiveCard";
import { useCreateHive } from "./useCreateHive";

type ListError = {
  message: string;
  correlationId: string | null;
};

type MyHivesPanelProps = {
  initialHives: Hive[];
  initialError?: ListError | null;
  openCreateOnLoad?: boolean;
};

export function MyHivesPanel({
  initialHives,
  initialError = null,
  openCreateOnLoad = false,
}: MyHivesPanelProps) {
  const router = useRouter();
  const [hives, setHives] = useState<Hive[]>(initialHives);
  const [listError, setListError] = useState<ListError | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);

  const handleCreated = useCallback(
    (hive: Hive) => {
      setHives((current) =>
        current.some((item) => item.id === hive.id) ? current : [hive, ...current],
      );
      router.push(hiveDocumentsPath(hive.id));
    },
    [router],
  );
  const createFlow = useCreateHive(handleCreated);
  const { openModal } = createFlow;

  useEffect(() => {
    if (!openCreateOnLoad) {
      return;
    }
    let cancelled = false;
    router.replace(MY_HIVES_PATH, { scroll: false });
    void loadGuestDraft().then((draft) => {
      if (!cancelled) {
        openModal(draft ?? undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [openCreateOnLoad, openModal, router]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setListError(null);
    try {
      const response = await fetchMyHives();
      setHives(response.hives);
    } catch (error) {
      setListError(
        error instanceof HiveClientError
          ? { message: error.message, correlationId: error.correlationId }
          : { message: "Could not load your Hives.", correlationId: null },
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-workspace flex-col gap-7 px-[clamp(16px,3vw,32px)] pb-16 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 font-brand text-[30px] font-semibold text-ink">
            My Hives
          </h1>
          <p className="mb-0 mt-1.5 text-[15px] leading-[1.5] text-ink-muted">
            Each Hive holds one situation: its documents, what Hive understands, the
            work and the result.
          </p>
        </div>
        <button
          type="button"
          className={PRIMARY_BUTTON_CLASS}
          onClick={() => openModal()}
          disabled={createFlow.submitBusy}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          New Hive
        </button>
      </div>

      {listError ? (
        <div
          role="alert"
          className="rounded-card border border-line bg-paper p-8 text-center"
        >
          <p className="m-0 text-sm text-ink">{listError.message}</p>
          {listError.correlationId ? (
            <p className="mb-0 mt-2 font-mono text-xs text-ink-subtle">
              Support reference: {listError.correlationId}
            </p>
          ) : null}
          <button
            type="button"
            className={`${SECONDARY_BUTTON_CLASS} mt-4`}
            disabled={refreshing}
            onClick={() => void handleRefresh()}
          >
            {refreshing ? "Loading…" : "Try again"}
          </button>
        </div>
      ) : null}

      {!listError && hives.length === 0 ? (
        <section
          aria-labelledby="empty-hives-title"
          className="flex flex-col items-center gap-4 rounded-card border border-dashed border-line-strong bg-paper px-[clamp(20px,4vw,32px)] py-16 text-center"
        >
          <HiveBrandMark variant="standalone" />
          <h2 id="empty-hives-title" className="m-0 font-brand text-[21px] font-medium text-ink">
            No Hives yet
          </h2>
          <p className="mx-auto m-0 max-w-[420px] text-[15px] leading-[1.55] text-ink-muted">
            Start with what you&apos;re trying to get done and at least one document
            you have.
          </p>
          <button
            type="button"
            className={PRIMARY_BUTTON_CLASS}
            onClick={() => openModal()}
            disabled={createFlow.submitBusy}
          >
            Start your first Hive
          </button>
        </section>
      ) : null}

      {hives.length > 0 ? <HiveCardGrid hives={hives} /> : null}

      <CreateHiveModal {...createFlow.modalProps} />
    </div>
  );
}
