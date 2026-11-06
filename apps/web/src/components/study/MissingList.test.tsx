// @vitest-environment jsdom
import type { StudyViewRow } from "@hiveforyou/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EvidenceViewerProvider } from "./EvidenceViewer";
import { groupMissing, MissingList, missingCount } from "./MissingList";
import { readProblemsFromCoverage, readProblemSentence } from "./ReadProblemNotice";

afterEach(cleanup);

const gap = (id: string, statement: string, extra: Partial<StudyViewRow> = {}): StudyViewRow => ({
  id,
  statement,
  relatedSpineIds: [],
  values: [],
  ...extra,
});

const REFERENCED = gap("X2", "The signed checklist is not supplied.", {
  relatedSpineIds: ["S1"],
  referencedBy: [{ sourceDocumentId: "doc-a", pageNumber: 4, quote: "see the checklist" }],
});

describe("groupMissing", () => {
  it("sorts gaps into referred-to and usually-expected, with read problems first", () => {
    const problems = [{ sourceDocumentId: "doc-b", label: "Bill", pageNumbers: [2], wholeDocument: false }];
    const groups = groupMissing([gap("X1", "No ledger."), REFERENCED], problems, "ANCHOR");
    expect(groups.unreadable).toEqual(problems);
    expect(groups.referenced.map((row) => row.id)).toEqual(["X2"]);
    expect(groups.expected.map((row) => row.id)).toEqual(["X1"]);
    expect(missingCount(groups)).toBe(3);
  });

  it("treats the first gap of a study without an anchor as a note, not a missing item", () => {
    const rows = [gap("X1", "No single document governs this case."), gap("X2", "No ledger.")];
    expect(groupMissing(rows, [], "TIMELINE").expected.map((row) => row.id)).toEqual(["X2"]);
    expect(groupMissing(rows, [], "ANCHOR").expected.map((row) => row.id)).toEqual(["X1", "X2"]);
    const related = [gap("X1", "Related.", { relatedSpineIds: ["S1"] })];
    expect(groupMissing(related, [], "PARTIES_AND_OBLIGATIONS").expected).toHaveLength(1);
  });
});

describe("MissingList", () => {
  it("shows only non-empty groups, a chip to the referring page, and no generic not-found line", () => {
    render(
      <EvidenceViewerProvider hiveId="h" labels={new Map([["doc-a", "Lease"]])} fileNames={{}}>
        <MissingList groups={groupMissing([REFERENCED], [], "ANCHOR")} />
      </EvidenceViewerProvider>,
    );
    expect(screen.queryByText("Could not be read")).toBeNull();
    expect(screen.getByText("Referred to but not supplied")).toBeTruthy();
    expect(screen.queryByText("Usually expected")).toBeNull();
    expect(screen.getByRole("button", { name: "Open Lease, page 4" })).toBeTruthy();
    expect(screen.queryByText(/Not found in the documents/)).toBeNull();
  });
});

describe("readProblemsFromCoverage", () => {
  const coverage = (sourceDocumentId: string, reason: string, pageNumbers: number[] = []) => ({
    sourceDocumentId,
    fileName: `${sourceDocumentId}.pdf`,
    reason: reason as never,
    pageNumbers,
  });

  it("merges pages per document, lists every page of an unreadable one, and skips documents not read yet", () => {
    const problems = readProblemsFromCoverage(
      [
        coverage("a", "PAGES_WITHOUT_TEXT", [4]),
        coverage("a", "PAGES_NOT_READ", [2, 4]),
        coverage("b", "NO_TEXT"),
        coverage("c", "NOT_READ"),
        coverage("d", "UNREADABLE"),
      ],
      (id) => (id === "a" ? "Statement" : undefined),
      (id) => (id === "b" ? 3 : undefined),
    );
    expect(problems).toEqual([
      { sourceDocumentId: "a", label: "Statement", pageNumbers: [2, 4], wholeDocument: false },
      { sourceDocumentId: "b", label: "b", pageNumbers: [1, 2, 3], wholeDocument: true },
      { sourceDocumentId: "d", label: "d", pageNumbers: [], wholeDocument: true },
    ]);
    expect(problems.map(readProblemSentence)).toEqual([
      "2 pages came back without text, so they are not part of this report.",
      "3 pages came back without text, so they are not part of this report.",
      "Its pages came back without text, so it is not part of this report.",
    ]);
  });
});
