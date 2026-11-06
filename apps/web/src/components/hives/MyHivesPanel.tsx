"use client";

import type { Hive } from "@hiveforyou/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from "@/components/button-classes";
import { HiveMark } from "@/components/study/HiveMark";
import type { HiveSummary } from "@/server/hives/hive-summary";
import { loadGuestDraft } from "@/lib/guest-draft";
import { HiveClientError, deleteHive, fetchMyHives } from "@/lib/hives-client";
import { MY_HIVES_PATH, hiveDocumentsPath } from "@/lib/hive-routes";

import { CreateHiveModal } from "./CreateHiveModal";
import { NameHiveDialog } from "./NameHiveDialog";
import { DeleteHiveModal } from "./DeleteHiveModal";
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
  summaries?: Readonly<Record<string, HiveSummary>>;
};

export function MyHivesPanel({
  initialHives,
  initialError = null,
  openCreateOnLoad = false,
  summaries,
}: MyHivesPanelProps) {
  const router = useRouter();
  const [hives, setHives] = useState<Hive[]>(initialHives);
  const [listError, setListError] = useState<ListError | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);
  const [hivePendingDelete, setHivePendingDelete] = useState<Hive | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const handleDeleteConfirm = useCallback(async () => {
    if (!hivePendingDelete) {
      return;
    }
    const hiveId = hivePendingDelete.id;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteHive(hiveId);
      setHivePendingDelete(null);
      setHives((current) => current.filter((hive) => hive.id !== hiveId));
    } catch (error) {
      setDeleteError(
        error instanceof HiveClientError
          ? error.message
          : "Could not delete this Hive. Try again.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }, [hivePendingDelete]);

  const handleRetryDeletion = useCallback(async (hiveId: string) => {
    await deleteHive(hiveId);
    setHives((current) => current.filter((hive) => hive.id !== hiveId));
  }, []);

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

  const empty = !listError && hives.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-hive flex-col gap-6 px-6 pb-16 pt-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 font-brand text-title font-semibold text-ink">
            My hives
          </h1>
          <p className="m-0 mt-1.5 max-w-prose text-body text-graphite">
            Each hive holds one situation: its documents, what they show, and the reports written from them.
          </p>
        </div>
        <button
          type="button"
          className={empty ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
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
          New hive
        </button>
      </div>

      {listError ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-card border border-line bg-paper p-7"
        >
          <p className="m-0 text-body text-ink">{listError.message}</p>
          {listError.correlationId ? (
            <p className="m-0 font-mono text-[12px] text-quiet">
              Support reference: {listError.correlationId}
            </p>
          ) : null}
          <button
            type="button"
            className={`${SECONDARY_BUTTON_CLASS} mt-2`}
            disabled={refreshing}
            onClick={() => void handleRefresh()}
          >
            {refreshing ? "Loading…" : "Try again"}
          </button>
        </div>
      ) : null}

      {empty ? (
        <section
          aria-labelledby="empty-hives-title"
          className="flex flex-col items-center gap-4 rounded-card border-2 border-dashed border-line bg-paper px-6 py-14 text-center"
        >
          <HiveMark className="h-10 w-10" />
          <h2 id="empty-hives-title" className="m-0 font-brand text-section font-semibold text-ink">
            No hives yet
          </h2>
          <p className="m-0 max-w-[420px] text-body text-graphite">
            Say what you&apos;re trying to get done and upload whatever you have to start your hive.
          </p>
          <button
            type="button"
            className={PRIMARY_BUTTON_CLASS}
            onClick={() => openModal()}
            disabled={createFlow.submitBusy}
          >
            Start your first hive
          </button>
        </section>
      ) : null}

      {hives.length > 0 ? (
        <HiveCardGrid
          hives={hives}
          summaries={summaries}
          onRequestDelete={setHivePendingDelete}
          onRetryDeletion={handleRetryDeletion}
        />
      ) : null}

      <CreateHiveModal {...createFlow.modalProps} />
      <NameHiveDialog {...createFlow.namingDialogProps} />
      <DeleteHiveModal
        hiveName={hivePendingDelete?.name ?? ""}
        open={hivePendingDelete !== null}
        busy={deleteBusy}
        errorMessage={deleteError}
        onCancel={() => {
          if (!deleteBusy) {
            setHivePendingDelete(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => {
          void handleDeleteConfirm();
        }}
      />
    </div>
  );
}
