"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { HiveComposer } from "@/components/HiveComposer";
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/button-classes";
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

const CARD_SHADOW =
  "shadow-[0_1px_2px_rgba(31,35,40,0.04),0_8px_28px_rgba(31,35,40,0.06)]";

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
    if (openCreateOnLoad) {
      router.replace(MY_HIVES_PATH, { scroll: false });
      openModal();
    }
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
    <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-9 px-4 py-10 md:px-8 md:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 font-brand text-[clamp(1.75rem,4vw,2.25rem)] font-semibold tracking-tight text-ink">
            My Hives
          </h1>
          <p className="mb-0 mt-2 text-[15px] text-ink-muted">
            Each Hive keeps one situation&apos;s documents and Study together.
          </p>
        </div>
        {hives.length > 0 ? (
          <button
            type="button"
            className={PRIMARY_BUTTON_CLASS}
            onClick={openModal}
            disabled={createFlow.submitBusy}
          >
            New Hive
          </button>
        ) : null}
      </div>

      <HiveComposer onSubmit={openModal} busy={createFlow.submitBusy} />

      {listError ? (
        <div
          role="alert"
          className="rounded-[18px] border border-line bg-paper p-8 text-center"
        >
          <p className="m-0 text-sm text-ink">{listError.message}</p>
          {listError.correlationId ? (
            <p className="mb-0 mt-2 font-mono text-xs text-ink-muted">
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
          className={`rounded-[18px] border border-line bg-paper px-6 py-12 text-center ${CARD_SHADOW}`}
        >
          <h2 id="empty-hives-title" className="m-0 text-xl font-semibold text-ink">
            Create a hive to get started
          </h2>
          <p className="mx-auto mb-0 mt-3 max-w-md text-[15px] leading-relaxed text-ink-muted">
            A Hive is a private space for one situation. Add the documents you
            have, and build an evidence-backed Study from them.
          </p>
          <button
            type="button"
            className={`${PRIMARY_BUTTON_CLASS} mt-6`}
            onClick={openModal}
            disabled={createFlow.submitBusy}
          >
            Create a Hive
          </button>
        </section>
      ) : null}

      {hives.length > 0 ? <HiveCardGrid hives={hives} /> : null}

      <CreateHiveModal {...createFlow.modalProps} />
    </div>
  );
}
