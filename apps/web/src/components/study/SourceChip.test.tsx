// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EvidenceViewerProvider } from "./EvidenceViewer";
import { dedupeChipRefs, shortDocumentLabels, shortTypeLabel, SourceChips } from "./SourceChip";

afterEach(cleanup);

describe("shortTypeLabel", () => {
  it.each([
    ["Repayment plan", "Repayment plan"],
    ["Repayment plan, first amended", "Repayment plan"],
    ["The water bill", "Water bill"],
    ["Plan dated April 10, 2026", "Plan"],
    ["March 2026 statement", "Statement"],
    ["Statement for July 2026", "Statement"],
    ["Petition and supporting schedules", "Petition"],
    ["Trustee's objection to the plan", "Trustee's objection"],
    ["Renters insurance renewal notice", "Insurance renewal notice"],
    ["Notice of hearing", "Notice of hearing"],
    ["meeting summary (draft)", "Meeting summary"],
    ["", ""],
    ["The", ""],
  ])("%j -> %j", (input, expected) => {
    expect(shortTypeLabel(input)).toBe(expected);
  });

  it("never returns more than three words", () => {
    expect(shortTypeLabel("Quarterly utility usage summary report").split(" ")).toHaveLength(3);
  });
});

describe("shortDocumentLabels", () => {
  it("adds month and year when two documents share a label, and falls back to Document", () => {
    const labels = shortDocumentLabels([
      { sourceDocumentId: "a", typeInPlainWords: "Plan", date: "2026-03-02" },
      { sourceDocumentId: "b", typeInPlainWords: "Plan, amended", date: "2026-04-28" },
      { sourceDocumentId: "c", typeInPlainWords: "Letter", date: null },
      { sourceDocumentId: "d", typeInPlainWords: "", date: null },
    ]);
    expect([...labels.values()]).toEqual(["Plan · Mar 2026", "Plan · Apr 2026", "Letter", "Document"]);
  });

  it("numbers documents that still share a label after the date is added", () => {
    const labels = shortDocumentLabels([
      { sourceDocumentId: "a", typeInPlainWords: "Invoice", date: "2026-08-01" },
      { sourceDocumentId: "b", typeInPlainWords: "Invoice", date: "2026-08-20" },
      { sourceDocumentId: "c", typeInPlainWords: "Invoice", date: null },
      { sourceDocumentId: "d", typeInPlainWords: "Invoice", date: null },
    ]);
    expect([...labels.values()]).toEqual(["Invoice · Aug 2026 · 1", "Invoice · Aug 2026 · 2", "Invoice · 1", "Invoice · 2"]);
  });
});

describe("dedupeChipRefs", () => {
  it("keeps one chip per document and page, merging distinct quotes, and drops invalid pages", () => {
    expect(
      dedupeChipRefs([
        { sourceDocumentId: "a", pageNumber: 2, quote: "first" },
        { sourceDocumentId: "b", pageNumber: 2 },
        { sourceDocumentId: "a", pageNumber: 2, quote: "second" },
        { sourceDocumentId: "a", pageNumber: 2, quote: "first" },
        { sourceDocumentId: "a", pageNumber: 0 },
      ]),
    ).toEqual([
      { sourceDocumentId: "a", pageNumber: 2, quote: "first\nsecond" },
      { sourceDocumentId: "b", pageNumber: 2 },
    ]);
  });
});

describe("SourceChips", () => {
  it("renders labelled buttons, never file names, and opens the evidence viewer with the file name", () => {
    render(
      <EvidenceViewerProvider
        hiveId="11111111-1111-4111-8111-111111111111"
        labels={new Map([["doc-a", "Plan · Mar 2026"]])}
        fileNames={{ "doc-a": { fileName: "02_plan.pdf" } }}
      >
        <p>
          A sentence.{" "}
          <SourceChips
            refs={[
              { sourceDocumentId: "doc-a", pageNumber: 3, quote: "The fee is $10." },
              { sourceDocumentId: "doc-a", pageNumber: 3, quote: "The fee is $10." },
            ]}
          />
        </p>
      </EvidenceViewerProvider>,
    );
    const chips = screen.getAllByTestId("source-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.tagName).toBe("BUTTON");
    expect(chips[0]!.textContent).toContain("Plan · Mar 2026 · p.3");
    expect(within(chips[0]!).getByTestId("cell-glyph")).toBeTruthy();
    expect(chips[0]!.getAttribute("aria-label")).toBe("Open Plan · Mar 2026, page 3");
    expect(screen.queryByText(/02_plan\.pdf/)).toBeNull();

    fireEvent.click(chips[0]!);
    const viewer = screen.getByTestId("evidence-viewer");
    expect(within(viewer).getByTestId("evidence-file-name").textContent).toBe("02_plan.pdf");
    expect(within(viewer).getByText("The fee is $10.")).toBeTruthy();
    expect(within(viewer).getByRole("link").getAttribute("href")).toBe(
      "/api/v1/hives/11111111-1111-4111-8111-111111111111/source-documents/doc-a/pages/3",
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("evidence-viewer")).toBeNull();
    expect(document.activeElement).toBe(chips[0]);
  });
});
