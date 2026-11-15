"use client";

import type { Hive } from "@hiveforyou/contracts";
import { rankHives } from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { HiveAppLogo } from "@/components/HiveWordmark";
import { HiveComposer } from "@/components/HiveComposer";
import { PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import type { StartingView } from "@/lib/auth/profile";
import { AddFilesButton } from "@/components/hives/SourceFilePicker";
import { loadGuestDraft } from "@/lib/guest-draft";
import { greetingLine } from "@/lib/hives/greeting";
import { HiveClientError, deleteHive, fetchMyHives } from "@/lib/hives-client";
import { MY_HIVES_PATH, NEW_CLIENT_HIVE_PATH, hiveDocumentsPath } from "@/lib/hive-routes";
import type { HiveSummary } from "@/server/hives/hive-summary";

import { CreateHiveModal } from "./CreateHiveModal";
import { DeleteHiveModal } from "./DeleteHiveModal";
import { HiveList } from "./HiveCard";
import { NameHiveDialog } from "./NameHiveDialog";
import { useCreateHive, useHiveComposer } from "./useCreateHive";

type ListError = {
  message: string;
  correlationId: string | null;
};

type HomeFilter = "all" | "needs_you" | "ready";

type MyHivesPanelProps = {
  initialHives: Hive[];
  initialError?: ListError | null;
  openCreateOnLoad?: boolean;
  summaries?: Readonly<Record<string, HiveSummary>>;
  startingView: StartingView;
  greetingFirstName: string | null;
  greetingEmail: string | null;
};

function hiveLastActivity(hive: Hive, summary: HiveSummary | undefined): string {
  const candidates = [hive.updatedAt, summary?.study?.acceptedAt].filter((value): value is string => !!value);
  return candidates.reduce<string>(
    (best, value) => (new Date(value).getTime() > new Date(best).getTime() ? value : best),
    hive.updatedAt,
  );
}

function MagnifierIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

export function MyHivesPanel({
  initialHives,
  initialError = null,
  openCreateOnLoad = false,
  summaries = {},
  startingView,
  greetingFirstName,
  greetingEmail,
}: MyHivesPanelProps) {
  const router = useRouter();
  const [hives, setHives] = useState<Hive[]>(initialHives);
  const [listError, setListError] = useState<ListError | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);
  const [hivePendingDelete, setHivePendingDelete] = useState<Hive | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [filter, setFilter] = useState<HomeFilter>("all");

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

  const primaryKind = startingView === "clients" ? "client" : "own";
  const secondaryKind = primaryKind === "client" ? "own" : "client";

  const { primaryHives, secondaryHives, filterCounts } = useMemo(() => {
    const query = findQuery.trim().toLowerCase();
    const eligible = hives.filter((hive) => {
      if (query && !hive.name.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });

    const ranked = rankHives(
      eligible.map((hive) => ({
        id: hive.id,
        level: summaries[hive.id]?.attention.level ?? "needs_you",
        lastActivityAt: hiveLastActivity(hive, summaries[hive.id]),
      })),
    );
    const hiveById = new Map(eligible.map((hive) => [hive.id, hive]));
    const ordered = ranked.map((row) => hiveById.get(row.id)).filter((hive): hive is Hive => hive !== undefined);

    const primary = ordered.filter((hive) => hive.kind === primaryKind);
    const secondary = ordered.filter((hive) => hive.kind === secondaryKind);

    const counts = {
      all: primary.length,
      needs_you: primary.filter((hive) => (summaries[hive.id]?.attention.level ?? "needs_you") === "needs_you").length,
      ready: primary.filter((hive) => summaries[hive.id]?.attention.level === "ready").length,
    };

    const filteredPrimary =
      filter === "all"
        ? primary
        : primary.filter((hive) => (summaries[hive.id]?.attention.level ?? "needs_you") === filter);

    return {
      primaryHives: filteredPrimary,
      secondaryHives: secondary,
      filterCounts: counts,
    };
  }, [filter, findQuery, hives, primaryKind, secondaryKind, summaries]);

  const clientsEmpty = startingView === "clients" && primaryHives.length === 0 && !listError;

  const countLine =
    startingView === "clients"
      ? `${filterCounts.all} ${filterCounts.all === 1 ? "client" : "clients"}, the ones that need you first`
      : primaryHives.length > 0
        ? `Your hives · ${primaryHives.length}`
        : null;

  const filters: { id: HomeFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: filterCounts.all },
    { id: "needs_you", label: "Needs you", count: filterCounts.needs_you },
    { id: "ready", label: "Ready", count: filterCounts.ready },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col items-center gap-5 px-5 pb-16 pt-[clamp(32px,8vh,88px)]">
      <HiveAppLogo display="lockup" size="landingMain" />
      <p className="m-0 text-[19px] text-graphite" data-testid="hives-greeting">
        {greetingLine(greetingFirstName, greetingEmail)}
      </p>

      {startingView === "clients" ? (
        <>
          <div className="flex w-full items-center gap-3 rounded-pill border border-line bg-paper px-5 shadow-[0_2px_12px_rgba(31,35,40,0.10)]">
            <MagnifierIcon />
            <input
              type="search"
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              placeholder="Find a client"
              aria-label="Find a client"
              className="min-h-11 w-full border-0 bg-transparent text-[17px] text-ink outline-none"
            />
          </div>
          <Link href={NEW_CLIENT_HIVE_PATH} className={PRIMARY_BUTTON_CLASS}>
            New client
          </Link>
          <nav
            aria-label="Filter clients"
            className="mt-1 flex w-full flex-wrap gap-1 border-b border-line"
          >
            {filters.map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`min-h-11 border-0 bg-transparent px-3 text-[14.5px] font-medium ${
                    active
                      ? "border-b-[3px] border-cell-blue-deep text-cell-blue-deep"
                      : "border-b-[3px] border-transparent text-graphite"
                  }`}
                  onClick={() => setFilter(tab.id)}
                >
                  {tab.label}
                  {tab.count > 0 ? ` (${tab.count})` : ""}
                </button>
              );
            })}
          </nav>
          {countLine ? (
            <p className="m-0 w-full text-left text-[14px] text-quiet">{countLine}</p>
          ) : null}
          {clientsEmpty ? (
            <p className="m-0 w-full text-left text-[15px] text-graphite">
              No clients yet. Start with the first one.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <MotionComposerLanding composer={inlineComposer} createBusy={createFlow.submitBusy} onOpenModal={() => openModal()} />
        </>
      )}

      {listError ? (
        <div role="alert" className="flex w-full flex-col items-start gap-2 text-left">
          <p className="m-0 text-body text-ink">{listError.message}</p>
          {listError.correlationId ? (
            <p className="m-0 font-mono text-[12px] text-quiet">Support reference: {listError.correlationId}</p>
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

      {primaryHives.length > 0 ? (
        <div className="w-full">
          {startingView === "own" && countLine ? (
            <p className="m-0 mb-4 text-left text-[14px] text-quiet">{countLine}</p>
          ) : null}
          <HiveList
            hives={primaryHives}
            summaries={summaries}
            startingView={startingView}
            onRequestDelete={setHivePendingDelete}
            onRetryDeletion={handleRetryDeletion}
            onKindChanged={handleRefresh}
          />
        </div>
      ) : null}

      {secondaryHives.length > 0 ? (
        <section className="w-full">
          <h2 className="m-0 mb-4 text-left font-brand text-section font-semibold text-ink">
            {startingView === "clients" ? "My own matters" : "Client hives"}
          </h2>
          <HiveList
            hives={secondaryHives}
            summaries={summaries}
            startingView={startingView}
            onRequestDelete={setHivePendingDelete}
            onRetryDeletion={handleRetryDeletion}
            onKindChanged={handleRefresh}
          />
        </section>
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