// @vitest-environment jsdom
import {
  buildHiveBoard,
  CANONICAL_STUDY_SCHEMA,
  type CanonicalGap,
  type CanonicalStudy,
  type HiveBoardInput,
} from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rebuildMock = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/hives/useStudyPreparation", () => ({
  useStudyPreparation: () => ({
    modalMode: null,
    action: "rebuild",
    run: null,
    state: {
      studyRevision: { id: "rev", revisionNumber: 1, createdAt: "2026-11-01T00:00:00.000Z" },
      eligibility: { documents: [] },
    },
    reportRuns: [],
    pollState: "ok",
    starting: false,
    startError: null,
    returnFocusRef: { current: null },
    closeModal: vi.fn(),
    confirmCoverage: vi.fn(),
    acknowledge: vi.fn(),
    retry: vi.fn(),
    rebuildAvailability: { canRebuild: true, reason: "READY" },
    rebuild: rebuildMock,
    active: false,
  }),
}));

import { HiveBoardPanel } from "./HiveBoardPanel";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-11-15";

const PATHS = {
  documentsPath: `/hives/${HIVE_ID}/documents`,
  studyPath: `/hives/${HIVE_ID}/study`,
  reportsPath: `/hives/${HIVE_ID}/reports`,
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

function boardInput(overrides: Partial<HiveBoardInput> = {}): HiveBoardInput {
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
    latestReportFinishedAt: "2026-11-10T00:00:00.000Z",
    storedEvents: [],
    ...PATHS,
    ...overrides,
  };
}

function filledActions(): HTMLElement[] {
  return [...screen.queryAllByRole("link"), ...screen.queryAllByRole("button")].filter((element) =>
    element.className.includes("bg-cell-blue-deep"),
  );
}

function renderPanel(input: HiveBoardInput, hasDocuments = true) {
  const board = buildHiveBoard(input, NOW);
  render(
    <HiveBoardPanel
      hiveId={HIVE_ID}
      hiveName="Widget batch"
      hiveDescription=""
      hasDocuments={hasDocuments}
      board={board}
      documentLabels={{}}
    />,
  );
  return board;
}

beforeEach(() => {
  rebuildMock.mockClear();
});

afterEach(cleanup);

describe("HiveBoardPanel", () => {
  it("shows exactly one filled button for an open conflict", () => {
    renderPanel(
      boardInput({
        conflictRows: [
          {
            id: "C1",
            subject: "amount",
            detail: "One record says $1; another says $2.",
            sourceChips: [],
          },
        ],
      }),
    );
    expect(filledActions()).toHaveLength(1);
    expect(filledActions()[0]?.textContent).toBe("Review");
    expect(filledActions()[0]?.getAttribute("href")).toBe(`${PATHS.studyPath}#where-documents-disagree`);
  });

  it("shows exactly one filled button for an unreadable document", () => {
    renderPanel(boardInput({ unreadableDocuments: [{ fileName: "scan.pdf" }] }));
    expect(filledActions()).toHaveLength(1);
    expect(filledActions()[0]?.textContent).toBe("Replace it");
    expect(filledActions()[0]?.getAttribute("href")).toBe(PATHS.documentsPath);
  });

  it("shows exactly one filled Rebuild study button when documents are newer than the study", () => {
    renderPanel(boardInput({ documentsNotInStudyCount: 2 }));
    expect(filledActions()).toHaveLength(1);
    expect(filledActions()[0]?.textContent).toBe("Rebuild study");
    fireEvent.click(filledActions()[0]!);
    expect(rebuildMock).toHaveBeenCalledTimes(1);
  });

  it("shows exactly one filled button when nothing is missing", () => {
    renderPanel(boardInput());
    expect(filledActions()).toHaveLength(1);
    expect(filledActions()[0]?.textContent).toBe("Open the latest report");
  });

  it("shows exactly one filled Add documents button when the hive has no documents", () => {
    renderPanel(boardInput({ documentCount: 0 }), false);
    expect(filledActions()).toHaveLength(1);
    expect(filledActions()[0]?.textContent).toBe("Add documents");
    expect(filledActions()[0]?.getAttribute("href")).toBe(PATHS.documentsPath);
  });

  it("shows no filled buttons while reading is in progress", () => {
    renderPanel(boardInput({ readingInProgress: true, readingProgressText: "1 of 2 documents read." }));
    expect(filledActions()).toHaveLength(0);
  });

  it("points Add it at the missing-slot anchor on the Documents tab", () => {
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
    renderPanel(
      boardInput({
        canonicalStudy: study,
        acceptedStudyRevisionId: "rev-1",
        documentsNotInStudyCount: 0,
        unreadableDocuments: [],
        conflictRows: [],
        hasSucceededReport: true,
      }),
    );
    const checklistAddIt = screen
      .getAllByRole("link", { name: "Add it" })
      .find((element) => element.getAttribute("href")?.includes("#missing-slot-"));
    expect(checklistAddIt?.getAttribute("href")).toBe(`${PATHS.documentsPath}#missing-slot-g1`);
  });

  it("does not render activity rows for events without a stored time", () => {
    renderPanel(
      boardInput({
        storedEvents: [
          { kind: "document_added", at: "not-a-date", fileName: "skip.pdf" },
          { kind: "document_added", at: "2026-11-01T10:00:00.000Z", fileName: "ok.pdf" },
        ],
      }),
    );
    expect(screen.getByText(/ok\.pdf/)).toBeTruthy();
    expect(screen.queryByText(/skip\.pdf/)).toBeNull();
  });
});