import { describe, expect, it } from "vitest";

import {
  CANONICAL_STUDY_SCHEMA,
  type CanonicalGap,
  type CanonicalStudy,
  type DocumentRole,
} from "../pipeline/canonical-study-contracts";

import {
  buildHiveBoard,
  hiveBoardOpenChecklistCount,
  type HiveBoardInput,
  type HiveBoardStoredEvent,
} from "./hive-board";

const BASE_PATHS = {
  documentsPath: "/hives/x/documents",
  studyPath: "/hives/x/study",
  reportsPath: "/hives/x/reports",
};

function gap(partial: Partial<CanonicalGap> & Pick<CanonicalGap, "id">): CanonicalGap {
  return {
    statement: partial.title ?? "Item",
    relatedSpineIds: [],
    kind: "REQUESTABLE_DOCUMENT",
    title: partial.title ?? "Item",
    why: partial.why ?? "",
    holder: partial.holder ?? "",
    holderType: partial.holderType ?? "ASKER_OR_CLIENT",
    when: null,
    basisType: null,
    relatedFactIds: [],
    ...partial,
  };
}

function baseInput(overrides: Partial<HiveBoardInput> = {}): HiveBoardInput {
  return {
    hiveName: "Widget batch",
    hiveKind: "own",
    documentCount: 3,
    documentsReadCount: 3,
    documentsNotInStudyCount: 0,
    readingInProgress: false,
    readingProgressText: null,
    unreadableDocuments: [],
    canonicalStudy: null,
    studyRevisionNumber: 1,
    hasSucceededReport: true,
    latestReportAudience: "CUSTOMER",
    latestReportFinishedAt: "2026-11-10T12:00:00.000Z",
    storedEvents: [],
    ...BASE_PATHS,
    ...overrides,
  };
}

describe("buildHiveBoard headlines", () => {
  it("uses review headlines when needs exist", () => {
    const board = buildHiveBoard(
      baseInput({
        unreadableDocuments: [{ fileName: "scan.pdf" }],
        conflictRows: [
          {
            id: "C1",
            subject: "amount",
            detail: "One record says $1; another says $2.",
            sourceChips: [],
          },
        ],
      }),
      "2026-11-15",
    );
<<<<<<< HEAD
    expect(board.headline).toBe("2 items for your review");
    expect(board.readiness.find((line) => line.label === "To review")?.value).toBe("2");
    expect(buildHiveBoard(baseInput({ unreadableDocuments: [{ fileName: "a.pdf" }] }), "2026-11-15").headline).toBe(
      "1 item for your review",
=======
    expect(board.headline).toBe("2 things to review");
    expect(buildHiveBoard(baseInput({ unreadableDocuments: [{ fileName: "a.pdf" }] }), "2026-11-15").headline).toBe(
      "1 thing to review",
>>>>>>> origin/main
    );
  });

  it("covers idle, reading, checklist, and all-clear headlines", () => {
    expect(buildHiveBoard(baseInput({ documentCount: 0 }), "2026-11-15").headline).toBe("Nothing is in yet");
    expect(buildHiveBoard(baseInput({ readingInProgress: true }), "2026-11-15").headline).toBe("Reading the documents");
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [gap({ id: "G1", title: "Tax return" })],
    };
    expect(
      buildHiveBoard(baseInput({ canonicalStudy: study, acceptedStudyRevisionId: "rev-1" }), "2026-11-15").headline,
    ).toBe("1 still to come");
    expect(buildHiveBoard(baseInput(), "2026-11-15").headline).toBe("Everything is in and checked");
  });
});

describe("buildHiveBoard needs order", () => {
  it("orders unreadable, not-in-study, then conflicts", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [{ id: "C1", statement: "Amounts differ", factIds: ["F1", "F2"] }],
      timeline: [],
      gaps: [],
    };
    const board = buildHiveBoard(
      baseInput({
        unreadableDocuments: [{ fileName: "bad.pdf" }],
        documentsNotInStudyCount: 2,
        canonicalStudy: study,
        conflictRows: [
          { id: "C1", subject: "amounts", detail: "One record says 1; another says 2.", sourceChips: [] },
        ],
      }),
      "2026-11-15",
    );
    expect(board.needs.map((item) => item.kind)).toEqual(["unreadable", "not_in_study", "conflict"]);
  });
});

describe("buildHiveBoard checklist", () => {
  const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const acceptedAt = "2026-11-01T00:00:00.000Z";

  it("marks in, pending rebuild, and not-in statuses", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [
        {
          sourceDocumentId: "d1",
          role: "SUPPORTING" as DocumentRole,
          typeInPlainWords: "Tax return",
          date: null,
          version: null,
          chainPosition: null,
        },
      ],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [gap({ id: "G1", title: "Tax return" }), gap({ id: "G2", title: "Lease" })],
    };
    const board = buildHiveBoard(
      baseInput({
        canonicalStudy: study,
        acceptedStudyRevisionId: revisionId,
        acceptedStudyRevisionAcceptedAt: acceptedAt,
        gapUploads: [
          {
            gapId: "G2",
            sourceDocumentId: "upload-1",
            gapTitle: "Lease",
            studyRevisionId: revisionId,
            registeredAt: "2026-11-02T00:00:00.000Z",
          },
        ],
      }),
      "2026-11-15",
    );
    expect(board.checklist.find((row) => row.gapId === "G1")?.status).toBe("in");
    expect(board.checklist.find((row) => row.gapId === "G2")?.status).toBe("added_pending");
    expect(board.checklist.find((row) => row.gapId === "G2")?.statusText).toContain("Rebuild");
  });
});

describe("buildHiveBoard next", () => {
  it("returns the add-documents card when empty", () => {
    const next = buildHiveBoard(baseInput({ documentCount: 0 }), "2026-11-15").next;
    expect(next?.title).toBe("Add the documents you have");
    expect(next?.action?.label).toBe("Add documents");
  });

  it("returns reading without a button while reads are active", () => {
    const next = buildHiveBoard(
      baseInput({ readingInProgress: true, readingProgressText: "2 of 3 documents read." }),
      "2026-11-15",
    ).next;
    expect(next?.title).toBe("Reading the documents");
    expect(next?.action).toBeNull();
  });

  it("points at the first open checklist slot", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [gap({ id: "G1", title: "Tax return" })],
    };
    const next = buildHiveBoard(
      baseInput({ canonicalStudy: study, acceptedStudyRevisionId: "rev-1", hasSucceededReport: true }),
      "2026-11-15",
    ).next;
    expect(next?.action?.label).toBe("Add it");
  });

  it("offers report generation then open latest", () => {
    const ready = buildHiveBoard(
      baseInput({ hasSucceededReport: false, studyRevisionNumber: 2 }),
      "2026-11-15",
    ).next;
    expect(ready?.action?.kind).toBe("generate_report");
    const done = buildHiveBoard(baseInput(), "2026-11-15").next;
    expect(done?.title).toBe("Nothing to review");
    expect(done?.action?.label).toBe("Open the latest report");
  });
});

describe("buildHiveBoard activity", () => {
  it("sorts newest first and caps at eight", () => {
    const events: HiveBoardStoredEvent[] = Array.from({ length: 10 }, (_, index) => ({
      kind: "document_added",
      at: `2026-11-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
      fileName: `file-${index}.pdf`,
    }));
    const activity = buildHiveBoard(baseInput({ storedEvents: events }), "2026-11-15").activity;
    expect(activity).toHaveLength(8);
    expect(activity[0]?.text).toContain("file-9");
    expect(activity[7]?.text).toContain("file-2");
  });

  it("never includes events without a stored time", () => {
    const activity = buildHiveBoard(
      baseInput({
        storedEvents: [
          { kind: "document_added", at: "not-a-date", fileName: "x.pdf" },
          { kind: "document_added", at: "2026-11-01T10:00:00.000Z", fileName: "ok.pdf" },
        ],
      }),
      "2026-11-15",
    ).activity;
    expect(activity).toHaveLength(1);
    expect(activity[0]?.text).toContain("ok.pdf");
  });
});

describe("hiveBoardOpenChecklistCount", () => {
  const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const acceptedAt = "2026-11-01T00:00:00.000Z";

  it("counts added_pending rows that the study missing list omits", () => {
    const study: CanonicalStudy = {
      schema: CANONICAL_STUDY_SCHEMA,
      domainLabel: "",
      spineSource: null,
      documents: [
        {
          sourceDocumentId: "d1",
          role: "SUPPORTING" as DocumentRole,
          typeInPlainWords: "Tax return",
          date: null,
          version: null,
          chainPosition: null,
        },
      ],
      spine: [],
      outsideSpine: [],
      conflicts: [],
      timeline: [],
      gaps: [
        gap({ id: "G-open", title: "Lease" }),
        gap({ id: "G-pending", title: "Insurance binder" }),
      ],
    };
    const boardInput: HiveBoardInput = {
      ...baseInput({
        canonicalStudy: study,
        acceptedStudyRevisionId: revisionId,
        acceptedStudyRevisionAcceptedAt: acceptedAt,
        gapUploads: [
          {
            gapId: "G-pending",
            sourceDocumentId: "upload-1",
            gapTitle: "Insurance binder",
            studyRevisionId: revisionId,
            registeredAt: "2026-11-02T00:00:00.000Z",
          },
        ],
      }),
    };
    const open = hiveBoardOpenChecklistCount(boardInput);
    expect(open).toBe(2);
    const board = buildHiveBoard(boardInput, "2026-11-15");
    expect(board.headline).toBe("2 still to come");
    expect(board.readiness.find((line) => line.label === "Missing")?.value).toBe("2");
  });
});

describe("buildHiveBoard kicker", () => {
  it("uses client intake wording", () => {
    expect(buildHiveBoard(baseInput({ hiveKind: "client", hiveName: "Ruth Ortiz" }), "2026-11-15").kicker).toBe(
      "Intake for Ruth Ortiz",
    );
    expect(buildHiveBoard(baseInput({ hiveKind: "own" }), "2026-11-15").kicker).toBe("Your hive");
  });
});