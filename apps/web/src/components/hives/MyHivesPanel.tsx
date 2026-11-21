"use client";

import type { Hive } from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { HiveAppLogo } from "@/components/HiveWordmark";
import { HiveComposer } from "@/components/HiveComposer";
import {
  QUIET_BUTTON_CLASS,
  QUIET_LINK_CLASS,
  SECONDARY_BUTTON_CLASS,
  WORKSPACE_PRIMARY,
} from "@/components/button-classes";
import type { StartingView } from "@/lib/auth/profile";
import { AddFilesButton } from "@/components/hives/SourceFilePicker";
import { Section } from "@/components/ui/Section";
import { Tabs, type TabOption } from "@/components/ui/Tabs";
import { loadGuestDraft } from "@/lib/guest-draft";
import { useClientsHomeSearch } from "@/lib/hives/clients-home-context";
import {
  clientsHomeHivesForQueue,
  clientsHomeQueueCounts,
  hiveLastActivity,
  parseClientsHomeQueue,
  type ClientsHomeQueue,
} from "@/lib/hives/clients-home-queue";
import { hiveListSentence } from "@/lib/hives/hive-list-copy";
import { groupHivesForList } from "@/lib/hives/hive-list-groups";
import { HiveClientError, deleteHive, fetchMyHives } from "@/lib/hives-client";
import { MY_HIVES_PATH, NEW_CLIENT_HIVE_PATH, hiveDocumentsPath } from "@/lib/hive-routes";
import type { HiveSummary } from "@/server/hives/hive-summary";

import { CreateHiveModal } from "./CreateHiveModal";
import { DeleteHiveModal } from "./DeleteHiveModal";
import { HivesFirstVisit, PlusIcon } from "./HivesFirstVisit";
import { HivesListRow } from "./HivesListRow";
import { HivesListSkeleton } from "./HivesListSkeleton";
import { NameHiveDialog } from "./NameHiveDialog";
import { HivesLeftMenu } from "./HivesLeftMenu";
import { useCreateHive, useHiveComposer } from "./useCreateHive";
import { useLeftMenuWide } from "@/lib/use-left-menu-wide";

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
  showFirmRail?: boolean;
  viewerUserId?: string | null;
  firmName?: string | null;
  personLine?: string | null;
};

export function MyHivesPanel({
  initialHives,
  initialError = null,
  openCreateOnLoad = false,
  summaries = {},
  startingView,
  showFirmRail = false,
  viewerUserId = null,
  firmName = null,
  personLine = null,
}: MyHivesPanelProps) {
  const wideMenu = useLeftMenuWide();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientsHome = useClientsHomeSearch();
  const findQuery = clientsHome?.findQuery ?? "";
  const searchTrimmed = findQuery.trim();
  const requestedQueue = parseClientsHomeQueue(searchParams.get("queue") ?? searchParams.get("view") ?? undefined);

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
  const hasClientHives = queueCounts.all > 0;
  const hasOwnHives = queueCounts.own > 0;

  // Queues that exist for this person. "All" shows own hives when there are no client hives.
  const tabOptions = useMemo(() => {
    const options: TabOption<ClientsHomeQueue>[] = [
      { id: "all", label: "All", count: hasClientHives ? queueCounts.all : queueCounts.own },
    ];
    if (showFirmRail) {
      options.push({ id: "mine", label: "Mine", count: queueCounts.mine });
      options.push({ id: "unassigned", label: "Unassigned", count: queueCounts.unassigned });
    }
    if (hasOwnHives && hasClientHives) {
      options.push({ id: "own", label: "Your own", count: queueCounts.own });
    }
    return options;
  }, [hasClientHives, hasOwnHives, queueCounts, showFirmRail]);

  const queue: ClientsHomeQueue = tabOptions.some((option) => option.id === requestedQueue) ? requestedQueue : "all";
  const queueForRows: ClientsHomeQueue = queue === "all" && !hasClientHives && hasOwnHives ? "own" : queue;

  const queueHives = useMemo(
    () => clientsHomeHivesForQueue(hives, summaries, queueForRows, viewerUserId, ""),
    [hives, queueForRows, summaries, viewerUserId],
  );
  const displayedHives = useMemo(
    () => (searchTrimmed ? clientsHomeHivesForQueue(hives, summaries, queueForRows, viewerUserId, searchTrimmed) : queueHives),
    [hives, queueForRows, queueHives, searchTrimmed, summaries, viewerUserId],
  );
  // Find looks across every hive, so a match is never hidden by the queue.
  const list = useMemo(() => groupHivesForList(displayedHives, summaries), [displayedHives, summaries]);
  const sentence = useMemo(() => {
    const { counts } = groupHivesForList(queueHives, summaries);
    return queueHives.some((hive) => summaries[hive.id]) ? hiveListSentence(counts) : null;
  }, [queueHives, summaries]);

  const modals = (
    <>
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
    </>
  );

  const errorBlock = listError ? (
    <div role="alert" className="mt-6 flex flex-col items-start gap-1 text-left">
      <p className="m-0 text-body text-ink">{listError.message}</p>
      {listError.correlationId ? (
        <p className="m-0 text-meta text-ink-3">
          Reference <span className="tabular-nums">{listError.correlationId.slice(0, 8)}</span>
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
  ) : null;

  // A person who has no hives yet. Professionals get the first visit; individuals get the composer.
  if (hives.length === 0 && !searchTrimmed && !listError) {
    if (startingView === "clients") {
      return (
        <>
          <HivesFirstVisit newHiveHref={NEW_CLIENT_HIVE_PATH} onStartOwn={() => openModal()} />
          {modals}
        </>
      );
    }
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col items-center gap-5 px-5 pb-16 pt-[clamp(32px,8vh,88px)]">
        <HiveAppLogo display="lockup" size="landingMain" />
        <MotionComposerLanding composer={inlineComposer} createBusy={createFlow.submitBusy} onOpenModal={() => openModal()} />
        {modals}
      </div>
    );
  }

  const newHiveControl =
    startingView === "clients" ? (
      <Link href={NEW_CLIENT_HIVE_PATH} className={WORKSPACE_PRIMARY} data-testid="new-hive">
        <PlusIcon />
        New hive
      </Link>
    ) : (
      <button type="button" className={WORKSPACE_PRIMARY} onClick={() => openModal()} data-testid="new-hive">
        <PlusIcon />
        New hive
      </button>
    );

  const noRows = displayedHives.length === 0 && !listError && !refreshing;
  const showYourOwn = hasOwnHives && hasClientHives;

  return (
    <div className="hv flex min-h-full flex-1 flex-col bg-canvas min-[1100px]:grid min-[1100px]:grid-cols-[232px_minmax(0,1fr)]">
      {startingView === "clients" ? (
        <HivesLeftMenu
          firmName={firmName}
          personLine={personLine}
          queue={queue}
          counts={queueCounts}
          showMine={showFirmRail}
          showUnassigned={showFirmRail}
          showYourOwn={showYourOwn}
          searchActive={Boolean(searchTrimmed)}
          onSelectQueue={setQueue}
        />
      ) : null}
      <div className="hv-main mx-auto w-full max-w-col-wide px-4 pb-24 pt-8 min-[760px]:px-8 min-[760px]:pt-10">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-[320px] min-[760px]:basis-[520px]">
          <h1 className="m-0 font-brand text-title-sm font-semibold text-ink min-[760px]:text-title">Your hives</h1>
          {sentence ? (
            <p className="m-0 mt-2.5 font-brand text-[20px] font-medium leading-[1.35] tracking-[-0.02em] text-ink min-[760px]:text-[22px]">
              {sentence}
            </p>
          ) : null}
        </div>
        {newHiveControl}
      </header>

      {tabOptions.length > 1 && !wideMenu ? (
        <Tabs options={tabOptions} value={queue} onChange={setQueue} ariaLabel="Which hives" className="mt-6" />
      ) : null}

      {errorBlock}

      {refreshing ? (
        <div className="mt-6">
          <HivesListSkeleton />
        </div>
      ) : null}

      {noRows ? (
        <section className="mt-8 flex flex-col items-start gap-1">
          <p className="m-0 text-[14.5px] text-ink-3">
            {searchTrimmed
              ? `No hive matches “${searchTrimmed}”. Try a client's first or last name.`
              : "Nothing here right now."}
          </p>
          {searchTrimmed && startingView === "clients" ? (
            <button
              type="button"
              className={QUIET_LINK_CLASS}
              onClick={() => {
                router.push(`${NEW_CLIENT_HIVE_PATH}?name=${encodeURIComponent(searchTrimmed)}`);
              }}
            >
              New client named {searchTrimmed}
            </button>
          ) : null}
        </section>
      ) : null}

      {!refreshing && list.groups.length > 0 ? (
        <div className="mt-8" data-testid="clients-home-list">
          {list.groups.map((group) => (
            <Section key={group.key} title={group.title} headingRight={group.hives.length}>
              <ul className="m-0 flex list-none flex-col p-0">
                {group.hives.map((hive) => (
                  <HivesListRow
                    key={hive.id}
                    hive={hive}
                    summary={summaries[hive.id]}
                    viewerUserId={viewerUserId}
                    lastActivityAt={hiveLastActivity(hive, summaries[hive.id])}
                    onRequestDelete={setHivePendingDelete}
                    onKindChanged={handleRefresh}
                  />
                ))}
              </ul>
            </Section>
          ))}
        </div>
      ) : null}

      {modals}
      </div>
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
