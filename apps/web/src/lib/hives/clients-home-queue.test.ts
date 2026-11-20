import { describe, expect, it } from "vitest";

import type { Hive } from "@hiveforyou/contracts";
import { hiveAttention } from "@hiveforyou/contracts";

import type { HiveSummary } from "@/server/hives/hive-summary";

import {
  clientsHomeHivesForQueue,
  clientsHomeQueueCounts,
  hiveMatchesClientsHomeQueue,
  parseClientsHomeQueue,
} from "./clients-home-queue";

const viewer = "11111111-1111-4111-8111-111111111111";

function hive(overrides: Partial<Hive> = {}): Hive {
  return {
    id: overrides.id ?? "550e8400-e29b-41d4-a716-446655440000",
    hiveId: overrides.id ?? "550e8400-e29b-41d4-a716-446655440000",
    name: "Alex Carter",
    description: "Benefits",
    kind: "client",
    clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
    ...overrides,
  };
}

const readySummary: HiveSummary = {
  documentCount: 1,
  intake: { total: 1, received: 1 },
  attention: hiveAttention({
    documentCount: 1,
    unreadableDocumentCount: 0,
    documentsNotReadCount: 0,
    activeReadCount: 0,
    processingRunFailed: false,
    processingRunActive: false,
    documentsNotInStudyCount: 0,
    openConflicts: 0,
    openNeeds: 0,
    openChanged: 0,
    openMissing: 0,
    openChecked: 1,
    hasStudy: true,
    hasReport: true,
  }),
  study: null,
};

const needsSummary: HiveSummary = {
  documentCount: 1,
  intake: { total: 2, received: 1 },
  attention: hiveAttention({
    documentCount: 1,
    unreadableDocumentCount: 0,
    documentsNotReadCount: 0,
    activeReadCount: 0,
    processingRunFailed: false,
    processingRunActive: false,
    documentsNotInStudyCount: 0,
    openConflicts: 0,
    openNeeds: 1,
    openChanged: 0,
    openMissing: 1,
    openChecked: 0,
    hasStudy: true,
    hasReport: false,
  }),
  study: null,
};

describe("clients-home-queue", () => {
  it("falls back unknown queue values to all", () => {
    expect(parseClientsHomeQueue("bogus")).toBe("all");
    expect(parseClientsHomeQueue(null)).toBe("all");
  });

  it("keeps queue counts aligned with filtered lists", () => {
    const needsHive = hive();
    const readyHive = hive({
      id: "660e8400-e29b-41d4-a716-446655440001",
      name: "Ready client",
      clientRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      updatedAt: "2026-11-14T00:00:00.000Z",
    });
    const ownHive = hive({ id: "770e8400-e29b-41d4-a716-446655440002", kind: "own", name: "Kitchen" });
    const mineHive = hive({
      id: "880e8400-e29b-41d4-a716-446655440003",
      firmId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: viewer,
      stage: "open",
    });
    const hives = [needsHive, readyHive, ownHive, mineHive];
    const summaries = {
      [needsHive.id]: needsSummary,
      [readyHive.id]: readySummary,
      [ownHive.id]: readySummary,
      [mineHive.id]: needsSummary,
    };

    const counts = clientsHomeQueueCounts(hives, summaries, viewer);
    expect(counts.needs).toBe(clientsHomeHivesForQueue(hives, summaries, "needs", viewer, "").length);
    expect(counts.ready).toBe(clientsHomeHivesForQueue(hives, summaries, "ready", viewer, "").length);
    expect(counts.all).toBe(clientsHomeHivesForQueue(hives, summaries, "all", viewer, "").length);
    expect(counts.own).toBe(clientsHomeHivesForQueue(hives, summaries, "own", viewer, "").length);
    expect(counts.mine).toBe(clientsHomeHivesForQueue(hives, summaries, "mine", viewer, "").length);
  });

  it("orders the review queue before waiting (in progress) and then by last activity", () => {
    const urgent = hive({ updatedAt: "2026-11-09T00:00:00.000Z" });
    const waiting = hive({
      id: "660e8400-e29b-41d4-a716-446655440001",
      updatedAt: "2026-11-15T00:00:00.000Z",
    });
    const summaries = {
      [urgent.id]: needsSummary,
      [waiting.id]: {
        ...readySummary,
        attention: hiveAttention({
          documentCount: 2,
          unreadableDocumentCount: 0,
          documentsNotReadCount: 1,
          activeReadCount: 0,
          processingRunFailed: false,
          processingRunActive: false,
          documentsNotInStudyCount: 0,
          openConflicts: 0,
          openNeeds: 0,
          openChanged: 0,
          openMissing: 0,
          openChecked: 0,
          hasStudy: false,
          hasReport: false,
        }),
      },
    };
    const ordered = clientsHomeHivesForQueue([waiting, urgent], summaries, "all", viewer, "");
    expect(ordered[0]?.id).toBe(urgent.id);
    expect(ordered[1]?.id).toBe(waiting.id);
  });

  it("filters search across all hives", () => {
    const ruth = hive({ name: "Ruth Ortiz" });
    const alex = hive({ id: "660e8400-e29b-41d4-a716-446655440001", name: "Alex Carter" });
    const summaries = { [ruth.id]: readySummary, [alex.id]: readySummary };
    const rows = clientsHomeHivesForQueue([ruth, alex], summaries, "all", viewer, "ruth");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Ruth Ortiz");
  });

  it("finds a hive by its title as well as the client's name", () => {
    const ruth = hive({ name: "Ruth Ortiz", description: "Plan confirmation" });
    const alex = hive({ id: "660e8400-e29b-41d4-a716-446655440001", name: "Alex Carter", description: "Intake" });
    const summaries = { [ruth.id]: readySummary, [alex.id]: readySummary };
    const rows = clientsHomeHivesForQueue([ruth, alex], summaries, "all", viewer, "PLAN conf");
    expect(rows.map((row) => row.name)).toEqual(["Ruth Ortiz"]);
  });

  it("excludes closed hives from mine", () => {
    const closed = hive({ firmId: "firm", assigneeUserId: viewer, stage: "closed" });
    expect(hiveMatchesClientsHomeQueue(closed, "mine", {}, viewer)).toBe(false);
  });
});