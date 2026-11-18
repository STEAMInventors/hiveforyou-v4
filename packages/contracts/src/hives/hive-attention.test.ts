import { describe, expect, it } from "vitest";

import {
  hiveAttention,
  rankHives,
  type HiveAttentionInput,
  type RankedHiveRef,
} from "./hive-attention";

const base: HiveAttentionInput = {
  documentCount: 3,
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

describe("hiveAttention", () => {
  it("reports no documents", () => {
    expect(hiveAttention({ ...base, documentCount: 0 }).sentence).toBe("No documents yet.");
  });

  it("reports unreadable documents", () => {
    const one = hiveAttention({ ...base, unreadableDocumentCount: 1 });
    expect(one.sentence).toBe("1 document could not be read.");
    const two = hiveAttention({ ...base, unreadableDocumentCount: 2 });
    expect(two.sentence).toBe("2 documents could not be read.");
  });

  it("reports failed run", () => {
    expect(hiveAttention({ ...base, processingRunFailed: true }).sentence).toBe(
      "The last run did not finish.",
    );
  });

  it("reports in progress while reading", () => {
    expect(hiveAttention({ ...base, activeReadCount: 1 }).level).toBe("in_progress");
    expect(hiveAttention({ ...base, documentsNotReadCount: 2 }).level).toBe("in_progress");
  });

  it("reports documents not in study", () => {
    expect(hiveAttention({ ...base, documentsNotInStudyCount: 2 }).sentence).toBe(
      "2 documents are not yet in the study.",
    );
  });

  it("reports conflicts and grouped needs", () => {
<<<<<<< HEAD
    expect(hiveAttention({ ...base, openConflicts: 1 }).sentence).toBe("1 conflict for your review.");
    expect(hiveAttention({ ...base, openNeeds: 1 }).sentence).toBe("1 item for your review.");
    expect(hiveAttention({ ...base, openNeeds: 2 }).sentence).toBe("2 items for your review.");
    expect(hiveAttention({ ...base, openNeeds: 1, openChanged: 2 }).sentence).toBe(
      "3 items for your review.",
=======
    expect(hiveAttention({ ...base, openConflicts: 1 }).sentence).toBe("1 conflict to review.");
    expect(hiveAttention({ ...base, openNeeds: 2 }).sentence).toBe("2 items to review.");
    expect(hiveAttention({ ...base, openNeeds: 1, openChanged: 2 }).sentence).toBe(
      "3 items to review.",
>>>>>>> origin/main
    );
  });

  it("reports missing, no study, no report", () => {
    expect(hiveAttention({ ...base, openMissing: 1 }).sentence).toBe("1 item is missing.");
    expect(hiveAttention({ ...base, hasStudy: false }).sentence).toBe("No study yet.");
    expect(hiveAttention({ ...base, hasReport: false }).sentence).toBe("No report yet.");
  });

  it("reports ready state", () => {
    expect(hiveAttention(base)).toEqual({
      level: "ready",
      sentence: "Everything is read and checked.",
      counts: { checked: 2 },
    });
  });

  it("omits zero counts and keeps state-bar order", () => {
    const result = hiveAttention({ ...base, openNeeds: 1, openChanged: 0, openMissing: 2 });
    expect(result.counts).toEqual({ needs: 1, missing: 2, checked: 2 });
  });
});

describe("rankHives", () => {
  const rows = (items: RankedHiveRef[]) => rankHives(items);

  it("orders needs_you before in_progress before ready", () => {
    const list: RankedHiveRef[] = [
      { id: "a", level: "ready", lastActivityAt: "2026-01-03T00:00:00.000Z" },
      { id: "b", level: "needs_you", lastActivityAt: "2026-01-01T00:00:00.000Z" },
      { id: "c", level: "in_progress", lastActivityAt: "2026-01-02T00:00:00.000Z" },
    ];
    expect(rows(list).map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties by most recent activity with stable order", () => {
    const list: RankedHiveRef[] = [
      { id: "old", level: "ready", lastActivityAt: "2026-01-01T00:00:00.000Z" },
      { id: "new", level: "ready", lastActivityAt: "2026-01-05T00:00:00.000Z" },
      { id: "mid", level: "ready", lastActivityAt: "2026-01-03T00:00:00.000Z" },
    ];
    expect(rows(list).map((item) => item.id)).toEqual(["new", "mid", "old"]);
  });

  it("keeps stable order when activity timestamps tie", () => {
    const ts = "2026-01-01T00:00:00.000Z";
    const list: RankedHiveRef[] = [
      { id: "first", level: "ready", lastActivityAt: ts },
      { id: "second", level: "ready", lastActivityAt: ts },
    ];
    expect(rows(list).map((item) => item.id)).toEqual(["first", "second"]);
  });
});