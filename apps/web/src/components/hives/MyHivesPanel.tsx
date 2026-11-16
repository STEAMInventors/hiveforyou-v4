"use client";

import type { Hive } from "@hiveforyou/contracts";
import { rankHives } from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { HiveAppLogo } from "@/components/HiveWordmark";
import { HiveComposer } from "@/components/HiveComposer";
import { QUIET_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import type { StartingView } from "@/lib/auth/profile";
import { AddFilesButton } from "@/components/hives/SourceFilePicker";
import { loadGuestDraft } from "@/lib/guest-draft";
import { useClientsHomeSearch } from "@/lib/hives/clients-home-context";
import {
  clientsHomeViewTitle,
  parseClientsHomeView,
  type ClientsHomeView,
} from "@/lib/hives/clients-home-view";
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

function RailDot({ kind }: { kind: "cell" | "leaf" | "honey" | "hollow" }) {
  if (kind === "hollow") {
    return (
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-pill border-2 border-line bg-transparent"
      />
    );
  }
  const color = kind === "cell" ? "bg-cell-blue" : kind === "honey" ? "bg-honey" : "bg-leaf";
  return <span aria-hidden className={`size-2.5 shrink-0 rounded-pill ${color}`} />;
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
  const view = parseClientsHomeView(searchParams.get("view") ?? undefined);

  const [hives, setHives] = useState<Hive[]>(initialHives);
  const [listError, setListError] = useState<ListError | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);
  const [hivePendingDelete, setHivePendingDelete] = useState<Hive | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const setView = useCallback(
    (next: ClientsHomeView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "all") {
        params.delete("view");
      } else {
        params.set("view", next);
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

  const clientHives = useMemo(() => hives.filter((hive) => hive.kind === "client"), [hives]);
  const ownHives = useMemo(() => hives.filter((hive) => hive.kind === "own"), [hives]);

  const railCounts = useMemo(() => {
    const needs = clientHives.filter((hive) => attentionLevel(hive.id, summaries) === "needs_you").length;
    const ready = clientHives.filter((hive) => attentionLevel(hive.id, summaries) === "ready").length;
    const mine = clientHives.filter(
      (hive) =>
        Boolean(hive.firmId) &&
        hive.stage !== "closed" &&
        Boolean(viewerUserId) &&
        hive.assigneeUserId?.toLowerCase() === viewerUserId?.toLowerCase(),
    ).length;
    const unassigned = clientHives.filter((hive) => Boolean(hive.firmId) && !hive.assigneeUserId).length;
    return {
      needs,
      ready,
      all: clientHives.length,
      own: ownHives.length,
      mine,
      unassigned,
      missingTotal: clientHives.reduce(
        (sum, hive) => sum + (summaries[hive.id]?.attention.counts.missing ?? 0),
        0,
      ),
    };
  }, [clientHives, ownHives, summaries, viewerUserId]);

  const displayedHives = useMemo(() => {
    const query = findQuery.trim().toLowerCase();
    if (query) {
      const matches = hives.filter((hive) => hive.name.toLowerCase().includes(query));
      return rankSubset(matches, summaries);
    }
    if (view === "own") {
      return rankSubset(ownHives, summaries);
    }
    let subset = clientHives;
    if (view === "needs") {
      subset = clientHives.filter((hive) => attentionLevel(hive.id, summaries) === "needs_you");
    } else if (view === "ready") {
      subset = clientHives.filter((hive) => attentionLevel(hive.id, summaries) === "ready");
    } else if (view === "mine") {
      subset = clientHives.filter(
        (hive) =>
          Boolean(hive.firmId) &&
          hive.stage !== "closed" &&
          Boolean(viewerUserId) &&
          hive.assigneeUserId?.toLowerCase() === viewerUserId?.toLowerCase(),
      );
    } else if (view === "unassigned") {
      subset = clientHives.filter((hive) => Boolean(hive.firmId) && !hive.assigneeUserId);
    }
    return rankSubset(subset, summaries);
  }, [clientHives, findQuery, hives, ownHives, summaries, view, viewerUserId]);

  if (startingView === "clients") {
    const title = clientsHomeViewTitle(view, findQuery);
    const showTiles = !findQuery.trim() && view === "all" && railCounts.all > 0;
    const clientsEmpty = railCounts.all === 0 && !findQuery.trim() && !listError;
    const noRows = displayedHives.length === 0 && !listError;
    const countLine = `${displayedHives.length} ${displayedHives.length === 1 ? "client" : "clients"}, the ones that need you first`;

    const railItems: {
      id: ClientsHomeView;
      label: string;
      count: number;
      dot: "cell" | "leaf" | "honey" | "hollow";
    }[] = [
      { id: "needs", label: "Needs you", count: railCounts.needs, dot: "cell" },
      { id: "ready", label: "Ready", count: railCounts.ready, dot: "leaf" },
      { id: "all", label: "All clients", count: railCounts.all, dot: "hollow" },
    ];
    if (showFirmRail) {
      railItems.unshift(
        { id: "mine", label: "Mine", count: railCounts.mine, dot: "cell" },
        { id: "unassigned", label: "Unassigned", count: railCounts.unassigned, dot: "honey" },
      );
    }
    if (railCounts.own > 0) {
      railItems.push({ id: "own", label: "My own matters", count: railCounts.own, dot: "hollow" });
    }

    return (
      <div className="flex flex-wrap items-start">
        <nav
          aria-label="Clients"
          className="flex w-full min-w-0 flex-wrap gap-2 px-5 pt-4 min-[760px]:w-64 min-[760px]:shrink-0 min-[760px]:flex-col min-[760px]:flex-nowrap min-[760px]:gap-0.5 min-[760px]:px-0 min-[760px]:py-4"
        >
          <Link
            href={NEW_CLIENT_HIVE_PATH}
            className="inline-flex min-h-14 w-full min-[760px]:w-auto items-center justify-center gap-2.5 self-start rounded-card border-0 bg-cell-blue-deep px-5 py-3 text-[15px] font-semibold text-paper no-underline shadow-[0_1px_3px_rgba(31,35,40,0.25)] transition-colors hover:bg-cell-blue-hover min-[760px]:ml-4"
          >
            <PlusIcon />
            New client
          </Link>
          <div className="flex w-full flex-wrap gap-1 min-[760px]:mt-3 min-[760px]:flex-col min-[760px]:gap-0.5">
            {railItems.map((item) => {
              const active = !findQuery.trim() && view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 w-full min-[760px]:w-auto items-center justify-between gap-3 rounded-pill min-[760px]:rounded-l-none min-[760px]:rounded-r-pill border-0 px-4 py-2 text-left text-[15px] font-medium min-[760px]:pl-7 min-[760px]:pr-4 ${
                    active
                      ? "bg-cell-blue-wash font-semibold text-cell-blue-deep"
                      : "bg-transparent text-ink hover:bg-mist"
                  }`}
                  onClick={() => setView(item.id)}
                >
                  <span className="flex items-center gap-3.5">
                    <RailDot kind={item.dot} />
                    {item.label}
                  </span>
                  {item.count > 0 ? (
                    <span className="text-[13px] font-semibold">{item.count}</span>
                  ) : (
                    <span className="text-[13px] font-semibold text-quiet">0</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="m-0 mt-4 hidden max-w-[200px] border-t border-line pt-3.5 text-[13px] leading-normal text-quiet min-[760px]:ml-7 min-[760px]:block">
            HiveForYou reads every document, keeps each client&apos;s list of what&apos;s missing, and
            tells you who needs you.
          </p>
        </nav>

        <main className="min-w-0 max-w-[1080px] flex-1 px-5 pb-16 pt-5 min-[760px]:pl-4 min-[760px]:pr-10">
          <header className="flex flex-col gap-1">
            <p className="m-0 text-[15px] text-graphite" data-testid="hives-greeting">
              {greetingLine(greetingFirstName)}
            </p>
            <h1 className="m-0 font-brand text-[28px] font-semibold leading-tight text-ink">{title}</h1>
            {!findQuery.trim() && view !== "own" ? (
              <p className="m-0 text-[14px] text-quiet">{countLine}</p>
            ) : null}
          </header>

          {showTiles ? (
            <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
              <GlanceTile
                count={railCounts.needs}
                label="Need you"
                subLabel=""
                colorClass="text-cell-blue-deep"
                onClick={() => setView("needs")}
              />
              <GlanceTile
                count={railCounts.missingTotal}
                label="Documents missing"
                subLabel="Across all clients"
                colorClass="text-missing-fg"
                onClick={() => setView("all")}
              />
              <GlanceTile
                count={railCounts.ready}
                label="Ready for review"
                subLabel="Everything in and checked"
                colorClass="text-leaf-deep"
                onClick={() => setView("ready")}
              />
            </div>
          ) : null}

          {listError ? (
            <div role="alert" className="mt-6 flex flex-col items-start gap-2 text-left">
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

          {clientsEmpty ? (
            <section className="mt-10 flex flex-col gap-3">
              <p className="m-0 text-[17px] text-ink">No clients yet. Start with the first one.</p>
              <p className="m-0 max-w-[520px] text-[15px] leading-relaxed text-graphite">
                Each client gets a hive. Add what they&apos;ve already sent you, and HiveForYou reads every
                page and keeps the list of what&apos;s missing.
              </p>
            </section>
          ) : null}

          {noRows && !clientsEmpty ? (
            <p className="m-0 mt-10 text-[17px] text-ink">
              {findQuery.trim()
                ? `No client matches “${findQuery.trim()}”.`
                : "Nothing here right now."}
            </p>
          ) : null}

          {displayedHives.length > 0 ? (
            <div className="mt-6">
              <HiveList
                hives={displayedHives}
                summaries={summaries}
                showColumnHeaders
                onRequestDelete={setHivePendingDelete}
                onRetryDeletion={handleRetryDeletion}
                onKindChanged={handleRefresh}
              />
            </div>
          ) : null}
        </main>

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
      <p className="m-0 text-[19px] text-graphite" data-testid="hives-greeting">
        {greetingLine(greetingFirstName)}
      </p>

      <MotionComposerLanding composer={inlineComposer} createBusy={createFlow.submitBusy} onOpenModal={() => openModal()} />

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

      {ownRanked.length > 0 ? (
        <div className="w-full">
          {countLine ? <p className="m-0 mb-4 text-left text-[14px] text-quiet">{countLine}</p> : null}
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

function GlanceTile({
  count,
  label,
  subLabel,
  colorClass,
  onClick,
}: {
  count: number;
  label: string;
  subLabel: string;
  colorClass: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer flex-col gap-0.5 rounded-card border border-line bg-paper p-4 text-left transition-colors hover:border-line-strong hover:bg-mist"
    >
      <span className={`font-brand text-[30px] font-semibold leading-tight ${colorClass}`}>{count}</span>
      <span className="text-[14px] font-medium text-ink">{label}</span>
      {subLabel ? <span className="text-[13px] text-quiet">{subLabel}</span> : null}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
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
