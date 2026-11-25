import { buildHiveBoard } from "@hiveforyou/contracts";
import { describe, expect, it } from "vitest";

import { GALLERY_HIVE, GALLERY_HIVE_ID } from "./board-messages";
import { MEDICAID_DOCUMENT_REQUEST_GAPS, MEDICAID_FINDINGS } from "./findings-gallery";

describe("MEDICAID gallery documents checklist", () => {
  it("derives Still to come rows from canonical request gaps", () => {
    const board = buildHiveBoard(
      {
        hiveName: GALLERY_HIVE.name,
        hiveKind: "client",
        documentsPath: `/hives/${GALLERY_HIVE_ID}/documents`,
        studyPath: `/hives/${GALLERY_HIVE_ID}`,
        reportsPath: `/hives/${GALLERY_HIVE_ID}/reports`,
        documentCount: 9,
        documentsReadCount: 9,
        documentsNotInStudyCount: 0,
        readingInProgress: false,
        readingProgressText: null,
        unreadableDocuments: [{ fileName: "June 2024 checking.pdf" }],
        canonicalStudy: MEDICAID_FINDINGS.canonicalStudy,
        acceptedStudyRevisionId: "rev-gallery",
        acceptedStudyRevisionAcceptedAt: "2026-10-20T00:00:00.000Z",
        studyRevisionNumber: 3,
        hasSucceededReport: true,
        latestReportAudience: "CUSTOMER",
        latestReportFinishedAt: "2026-10-21T00:00:00.000Z",
        storedEvents: [],
      },
      "2026-10-28",
    );
    expect(board.checklist).toHaveLength(MEDICAID_DOCUMENT_REQUEST_GAPS.length);
    expect(board.checklist.every((row) => row.status === "not_in")).toBe(true);
    expect(board.checklist.map((row) => row.title)).toEqual(
      MEDICAID_DOCUMENT_REQUEST_GAPS.map((gap) => gap.title),
    );
  });
});