"use client";

import type { Hive } from "@hiveforyou/contracts";
import { rankHives } from "@hiveforyou/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Card } from "@/components/workspace/Card";
import { HiveAppLogo } from "@/components/HiveWordmark";
import { HiveComposer } from "@/components/HiveComposer";
import { QUIET_BUTTON_CLASS, SECONDARY_BUTTON_CLASS, WORKSPACE_PRIMARY } from "@/components/button-classes";
import type { StartingView } from "@/lib/auth/profile";
import { AddFilesButton } from "@/components/hives/SourceFilePicker";
import { loadGuestDraft } from "@/lib/guest-draft";
import { useClientsHomeSearch } from "@/lib/hives/clients-home-context";
import {
  clientsHomeHivesForQueue,
  clientsHomeQueueCounts,
  clientsHomeQueueTitle,
  parseClientsHomeQueue,
  type ClientsHomeQueue,
} from "@/lib/hives/clients-home-queue";
import { greetingLine } from "@/lib/hives/greeting";
import { HiveClientError, deleteHive, fetchMyHives } from "@/lib/hives-client";
import { CREATE_HIVE_PARAM, MY_HIVES_PATH, hiveDocumentsPath } from "@/lib/hive-routes";
import type { HiveSummary } from "@/server/hives/hive-summary";

import { ClientsHomeClientList } from "./ClientsHomeClientList";
import { ClientsHomeFirstVisit } from "./ClientsHomeFirstVisit";
import { ClientsHomeSidebar } from "./ClientsHomeSidebar";
import { CreateHiveModal } from "./CreateHiveModal";
import { DeleteHiveModal } from "./DeleteHiveModal";
import { HiveList } from "./HiveCard";
import { NameHiveDialog } from "./NameHiveDialog";
import { useCreateHive, useHiveComposer } from "./useCreateHive";

type ListError = {
  message: string;
  correlationId: string | null;
};

type MyHivesPanelProps = {
  initialHives: Hive[];
  initialError?: ListError | null;
  openCreateOnLoad?: boolean;
  summaries?: Readonly<Record<string, HiveSummary>>;
  startingView: StartingView;
  greetingFirstName: string | null;
  showFirmRail?: boolean;
  viewerUserId?: string | null;
};

function hiveLastActivity(hive: Hive, summary: HiveSummary | undefined): string {
  const candidates = [hive.updatedAt, summary?.study?.acceptedAt].filter((value): value is string => !!value);
  return candidates.reduce<string>(
    (best, value) => (new Date(value).getTime() > new Date(best).getTime() ? value : best),
    hive.updatedAt,
  );
}

function attentionLevel(hiveId: string, summaries: Readonly<Record<string, HiveSummary>>) {
  return summaries[hiveId]?.attention.level ?? "needs_you";
}

function rankSubset(
  hives: Hive[],
  summaries: Readonly<Record<string, HiveSummary>>,
): Hive[] {
  const ranked = rankHives(
    hives.map((hive) => ({
      id: hive.id,
      level: attentionLevel(hive.id, summaries),
      lastActivityAt: hiveLastActivity(hive, summaries[hive.id]),
    })),
  );
  const byId = new Map(hives.map((hive) => [hive.id, hive]));
  return ranked.map((row) => byId.get(row.id)).filter((hive): hive is Hive => hive !== undefined);
}

export function MyHivesPanel({
  initialHives,
  initialError = null,
  openCreateOnLoad = false,
  summaries = {},
  startingView,
  greetingFirstName,
  showFirmRail = false,
  viewerUserId = null,
}: MyHivesPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientsHome = useClientsHomeSearch();
  const findQuery = clientsHome?.findQuery ?? "";
  const legacyView = searchParams.get("view");
  const queue = parseClientsHomeQueue(searchParams.get("queue") ?? legacyView ?? undefined);
  const [compactNav, setCompactNav] = useState(false);

  const [hives, setHives] = useState<Hive[]>(initialHives);
  const [listError, setListError] = useState<ListError | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);
  const [hivePendingDelete, setHivePendingDelete] = useState<Hive | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const setQueue = useCallback(
    (next: ClientsHomeQueue) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("view");
      params.delete("q");
      if (next === "all") {
        params.delete("queue");
      } else {
        params.set("queue", next);
      }
      clientsHome?.setFindQuery("");
      const query = params.toString();
      router.replace(query ? `${MY_HIVES_PATH}?${query}` : MY_HIVES_PATH, { scroll: false });
    },
    [clientsHome, router, searchParams],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 899px)");
    const apply = () => setCompactNav(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

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

  const inlineComposer = useHiveComposer((draft) => {
    openModal(draft);
  });

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
          : { message: "Could not load your hives.", correlationId: null },
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  const queueCounts = useMemo(
    () => clientsHomeQueueCounts(hives, summaries, viewerUserId),
    [hives, summaries, viewerUserId],
  );

  const displayedHives = useMemo(
    () => clientsHomeHivesForQueue(hives, summaries, queue, viewerUserId, findQuery),
    [findQuery, hives, queue, summaries, viewerUserId],
  );

  if (startingView === "clients") {
    const title = clientsHomeQueueTitle(queue, findQuery);
    const clientsEmpty = queueCounts.all === 0 && !findQuery.trim() && !listError;
    const noRows = displayedHives.length === 0 && !listError;
    const countLine =
      displayedHives.length === 1
        ? "1 client, the ones with something to review first"
        : `${displayedHives.length} clients, the ones with something to review first`;
    const searchTrimmed = findQuery.trim();

    const sidebar = (
      <ClientsHomeSidebar
        queue={queue}
        counts={queueCounts}
        showFirmRail={showFirmRail}
        hasOwnHives={queueCounts.own > 0}
        searchActive={Boolean(searchTrimmed)}
        compact={compactNav}
        onSelectQueue={setQueue}
      />
    );

    return (
      <div className="flex min-h-full flex-1 flex-col bg-mist min-[900px]:grid min-[900px]:grid-cols-[236px_minmax(0,1fr)]">
        {compactNav ? (
          <div className="border-b border-line bg-paper px-3 py-2 min-[900px]:hidden">{sidebar}</div>
        ) : (
          <div className="hidden min-[900px]:block min-[900px]:border-r min-[900px]:border-line">{sidebar}</div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-col-wide flex-1 flex-col gap-4 px-4 py-6 min-[900px]:px-8 min-[900px]:pb-16">
            <header className="flex flex-col gap-1">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 text-small text-ink-2" data-testid="hives-greeting">
                    {greetingLine(greetingFirstName)}
                  </p>
                  <h1 className="m-0 font-brand text-section font-semibold text-ink">{title}</h1>
                </div>
                <button type="button" className={WORKSPACE_PRIMARY} onClick={() => openModal()} data-testid="new-hive">
                  New hive
                </button>
              </div>
              {clientsHome?.enabled ? (
                <label className="mt-3 flex h-11 items-center gap-2 rounded-input bg-mist px-3.5">
                  <span className="sr-only">Find a client</span>
                  <input
                    type="search"
                    value={clientsHome.findQuery}
                    onChange={(event) => clientsHome.setFindQuery(event.target.value)}
                    placeholder="Find a client"
                    aria-label="Find a client"
                    data-testid="header-find-client"
                    className="h-full w-full border-0 bg-transparent text-body text-ink outline-none"
                  />
                </label>
              ) : null}
              {!searchTrimmed && queue !== "own" ? <p className="m-0 text-small text-ink-3">{countLine}</p> : null}
            </header>

            {listError ? (
              <div role="alert" className="flex flex-col items-start gap-2 text-left">
                <p className="m-0 text-body text-ink">{listError.message}</p>
                {listError.correlationId ? (
                  <p className="m-0 font-mono text-caption text-ink-3">Support reference: {listError.correlationId}</p>
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

            {clientsEmpty ? (
              <Card className="overflow-hidden px-0 py-0">
                <ClientsHomeFirstVisit firstName={greetingFirstName} />
              </Card>
            ) : null}

            {noRows && !clientsEmpty ? (
              <section className="flex flex-col items-start gap-3">
                <p className="m-0 text-body text-ink">
                  {searchTrimmed
                    ? `No client matches “${searchTrimmed}”.`
                    : "Nothing here right now."}
                </p>
                {searchTrimmed ? (
                  <button
                    type="button"
                    className={WORKSPACE_PRIMARY}
                    onClick={() => {
                      router.push(`/hives/new-client?name=${encodeURIComponent(searchTrimmed)}`);
                    }}
                  >
                    New client named {searchTrimmed}
                  </button>
                ) : null}
              </section>
            ) : null}

            {displayedHives.length > 0 ? (
              <ClientsHomeClientList
                hives={displayedHives}
                summaries={summaries}
                viewerUserId={viewerUserId}
                onRequestDelete={setHivePendingDelete}
                onKindChanged={handleRefresh}
              />
            ) : null}
          </div>
        </div>

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

  const ownRanked = rankSubset(hives.filter((hive) => hive.kind === "own"), summaries);
  const countLine =
    ownRanked.length > 0 ? (ownRanked.length === 1 ? "Your hive" : `Your hives · ${ownRanked.length}`) : null;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col items-center gap-5 px-5 pb-16 pt-[clamp(32px,8vh,88px)]">
      <HiveAppLogo display="lockup" size="landingMain" />
      <p className="m-0 text-[19px] text-ink-2" data-testid="hives-greeting">
        {greetingLine(greetingFirstName)}
      </p>

      <MotionComposerLanding composer={inlineComposer} createBusy={createFlow.submitBusy} onOpenModal={() => openModal()} />

      {listError ? (
        <div role="alert" className="flex w-full flex-col items-start gap-2 text-left">
          <p className="m-0 text-body text-ink">{listError.message}</p>
          {listError.correlationId ? (
            <p className="m-0 font-mono text-[12px] text-ink-3">Support reference: {listError.correlationId}</p>
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

      {ownRanked.length > 0 ? (
        <div className="w-full">
          {countLine ? <p className="m-0 mb-4 text-left text-[14px] text-ink-3">{countLine}</p> : null}
          <HiveList
            hives={ownRanked}
            summaries={summaries}
            onRequestDelete={setHivePendingDelete}
            onRetryDeletion={handleRetryDeletion}
            onKindChanged={handleRefresh}
          />
        </div>
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

function MotionComposerLanding({
  composer,
  createBusy,
  onOpenModal,
}: {
  composer: ReturnType<typeof useHiveComposer>;
  createBusy: boolean;
  onOpenModal: () => void;
}) {
  const { composerProps } = composer;
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <HiveComposer {...composerProps} presentation="landing" />
      <div className="flex flex-wrap justify-center gap-3">
        <AddFilesButton
          label="Add documents"
          showLabel
          disabled={composerProps.busy}
          onAdd={composerProps.onAddFiles}
          className={QUIET_BUTTON_CLASS}
        />
        <button
          type="button"
          className={QUIET_BUTTON_CLASS}
          disabled={createBusy || composerProps.busy}
          onClick={onOpenModal}
        >
          Start a new hive
        </button>
      </div>
    </div>
  );
}
