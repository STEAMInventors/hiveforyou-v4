import type { Hive, HiveAttentionLevel } from "@hiveforyou/contracts";
import { rankHives } from "@hiveforyou/contracts";

import { STATE_LABEL } from "@/components/study/status-state";

import type { HiveSummary } from "@/server/hives/hive-summary";

export type ClientsHomeQueue = "all" | "needs" | "ready" | "own" | "mine" | "unassigned";

export function parseClientsHomeQueue(raw: string | null | undefined): ClientsHomeQueue {
  if (raw === "needs" || raw === "ready" || raw === "own" || raw === "mine" || raw === "unassigned") {
    return raw;
  }
  return "all";
}

/** @deprecated use parseClientsHomeQueue — still accepts legacy `view` query values */
export const parseClientsHomeView = parseClientsHomeQueue;

export type ClientsHomeQueueCounts = {
  needs: number;
  ready: number;
  all: number;
  own: number;
  mine: number;
  unassigned: number;
};

function attentionLevel(hiveId: string, summaries: Readonly<Record<string, HiveSummary>>): HiveAttentionLevel {
  return summaries[hiveId]?.attention.level ?? "needs_you";
}

function hiveLastActivity(hive: Hive, summary: HiveSummary | undefined): string {
  const candidates = [hive.updatedAt, summary?.study?.acceptedAt].filter((value): value is string => !!value);
  return candidates.reduce<string>(
    (best, value) => (new Date(value).getTime() > new Date(best).getTime() ? value : best),
    hive.updatedAt,
  );
}

function isMineHive(hive: Hive, viewerUserId: string | null | undefined): boolean {
  return (
    Boolean(hive.firmId) &&
    hive.stage !== "closed" &&
    Boolean(viewerUserId) &&
    hive.assigneeUserId?.toLowerCase() === viewerUserId?.toLowerCase()
  );
}

function isUnassignedFirmHive(hive: Hive): boolean {
  return Boolean(hive.firmId) && !hive.assigneeUserId;
}

export function hiveMatchesClientsHomeQueue(
  hive: Hive,
  queue: ClientsHomeQueue,
  summaries: Readonly<Record<string, HiveSummary>>,
  viewerUserId: string | null | undefined,
): boolean {
  if (queue === "own") {
    return hive.kind === "own";
  }
  if (hive.kind !== "client") {
    return false;
  }
  switch (queue) {
    case "needs":
      return attentionLevel(hive.id, summaries) === "needs_you";
    case "ready":
      return attentionLevel(hive.id, summaries) === "ready";
    case "mine":
      return isMineHive(hive, viewerUserId);
    case "unassigned":
      return isUnassignedFirmHive(hive);
    default:
      return true;
  }
}

export function clientsHomeQueueCounts(
  hives: readonly Hive[],
  summaries: Readonly<Record<string, HiveSummary>>,
  viewerUserId: string | null | undefined,
): ClientsHomeQueueCounts {
  const clientHives = hives.filter((hive) => hive.kind === "client");
  const ownHives = hives.filter((hive) => hive.kind === "own");
  return {
    needs: clientHives.filter((hive) => attentionLevel(hive.id, summaries) === "needs_you").length,
    ready: clientHives.filter((hive) => attentionLevel(hive.id, summaries) === "ready").length,
    all: clientHives.length,
    own: ownHives.length,
    mine: clientHives.filter((hive) => isMineHive(hive, viewerUserId)).length,
    unassigned: clientHives.filter((hive) => isUnassignedFirmHive(hive)).length,
  };
}

export function clientsHomeHivesForQueue(
  hives: readonly Hive[],
  summaries: Readonly<Record<string, HiveSummary>>,
  queue: ClientsHomeQueue,
  viewerUserId: string | null | undefined,
  searchQuery: string,
): Hive[] {
  const query = searchQuery.trim().toLowerCase();
  const pool = query
    ? hives.filter((hive) => hive.name.toLowerCase().includes(query))
    : hives.filter((hive) => hiveMatchesClientsHomeQueue(hive, queue, summaries, viewerUserId));

  const ranked = rankHives(
    pool.map((hive) => ({
      id: hive.id,
      level: attentionLevel(hive.id, summaries),
      lastActivityAt: hiveLastActivity(hive, summaries[hive.id]),
    })),
  );
  const byId = new Map(pool.map((hive) => [hive.id, hive]));
  return ranked.map((row) => byId.get(row.id)).filter((hive): hive is Hive => hive !== undefined);
}

export function clientsHomeQueueTitle(queue: ClientsHomeQueue, searchQuery: string): string {
  const q = searchQuery.trim();
  if (q) {
    return `Clients matching “${q}”`;
  }
  switch (queue) {
    case "needs":
      return STATE_LABEL.needs;
    case "ready":
      return "Ready for review";
    case "own":
      return "My own matters";
    case "mine":
      return "Mine";
    case "unassigned":
      return "Unassigned";
    default:
      return "All clients";
  }
}

/** @deprecated use clientsHomeQueueTitle */
export const clientsHomeViewTitle = clientsHomeQueueTitle;

export type ClientsHomeView = ClientsHomeQueue;