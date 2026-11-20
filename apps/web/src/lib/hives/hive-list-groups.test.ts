import type { Hive } from "@hiveforyou/contracts";
import { hiveAttention } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import type { HiveSummary } from "@/server/hives/hive-summary";

import { groupHivesForList } from "./hive-list-groups";

const base = {
  documentCount: 2,
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
  openChecked: 2,
  hasStudy: true,
  hasReport: true,
};

function summary(overrides: Partial<typeof base>): HiveSummary {
  return {
    documentCount: 2,
    intake: { total: 2, received: 2 },
    attention: hiveAttention({ ...base, ...overrides }),
    study: null,
  };
}

function hive(id: string, name: string): Hive {
  return {
    id,
    hiveId: id,
    name,
    description: null,
    kind: "client",
    clientRequestId: id,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-14T00:00:00.000Z",
  };
}

describe("groupHivesForList", () => {
  const review = hive("a", "Review hive");
  const reading = hive("b", "Reading hive");
  const waiting = hive("c", "Waiting hive");
  const done = hive("d", "Done hive");
  const unknown = hive("e", "No summary hive");

  const summaries = {
    a: summary({ openNeeds: 1 }),
    b: summary({ activeReadCount: 1, processingRunActive: true }),
    c: summary({ openMissing: 2 }),
    d: summary({}),
  };

  it("orders groups To review, Being read, Waiting on documents, Up to date and keeps rank inside each", () => {
    const second = hive("f", "Second review hive");
    const model = groupHivesForList([done, waiting, review, second, reading], { ...summaries, f: summary({ openNeeds: 2 }) });
    expect(model.groups.map((group) => group.title)).toEqual([
      "To review",
      "Being read",
      "Waiting on documents",
      "Up to date",
    ]);
    expect(model.groups[0]!.hives.map((item) => item.name)).toEqual(["Review hive", "Second review hive"]);
  });

  it("leaves empty groups out", () => {
    const model = groupHivesForList([done], summaries);
    expect(model.groups.map((group) => group.key)).toEqual(["done"]);
  });

  it("counts only hives with a summary and puts a hive without one in To review", () => {
    const model = groupHivesForList([review, reading, waiting, done, unknown], summaries);
    expect(model.counts).toEqual({ review: 1, waiting: 1, reading: 1 });
    expect(model.groups[0]!.hives.map((item) => item.name)).toEqual(["Review hive", "No summary hive"]);
  });

  it("returns no groups for no hives", () => {
    expect(groupHivesForList([], {})).toEqual({ groups: [], counts: { review: 0, waiting: 0, reading: 0 } });
  });
});
