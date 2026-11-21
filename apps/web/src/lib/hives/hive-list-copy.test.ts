import { hiveAttention } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { hiveListSentence, hiveRowStatuses } from "./hive-list-copy";

describe("hiveListSentence", () => {
  it("omits zero parts and joins the rest", () => {
    expect(hiveListSentence({ review: 2, waiting: 0, reading: 1 })).toBe(
      "2 hives have things to review. 1 is being read.",
    );
  });

  it("uses singular forms", () => {
    expect(hiveListSentence({ review: 1, waiting: 1, reading: 1 })).toBe(
      "1 hive has things to review. 1 is waiting on documents. 1 is being read.",
    );
  });

  it("reports all clear", () => {
    expect(hiveListSentence({ review: 0, waiting: 0, reading: 0 })).toBe("Everything is up to date.");
  });
});

describe("hiveRowStatuses", () => {
  it("orders count dots before fallback reason dots", () => {
    const attention = hiveAttention({
      documentCount: 3,
      unreadableDocumentCount: 0,
      documentsNotReadCount: 0,
      activeReadCount: 0,
      processingRunFailed: false,
      processingRunActive: false,
      documentsNotInStudyCount: 0,
      openConflicts: 0,
      openNeeds: 2,
      openChanged: 1,
      openMissing: 0,
      openChecked: 0,
      hasStudy: true,
      hasReport: true,
    });
    expect(hiveRowStatuses(attention).map((row) => row.label)).toEqual(["2 to review", "1 changed"]);
  });

  it("shows grey reading and leaf ready fallbacks", () => {
    const reading = hiveAttention({
      documentCount: 1,
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
    });
    expect(hiveRowStatuses(reading)[0]?.label).toBe("Reading the documents");

    const ready = hiveAttention({
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
    });
    expect(hiveRowStatuses(ready)[0]?.label).toBe("Up to date");
  });
});