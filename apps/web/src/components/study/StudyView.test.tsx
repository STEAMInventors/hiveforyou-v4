// @vitest-environment jsdom
import { STUDY_VIEW_SCHEMA, type StudyView as StudyViewData, type StudyViewSources } from "@hiveforyou/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StudyView } from "./StudyView";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const DOC_A = "aaaa0001-0000-4000-8000-000000000001";
const DOC_B = "bbbb0002-0000-4000-8000-000000000002";

const pageUrl = (documentId: string, page: number) =>
  `/api/v1/hives/${HIVE_ID}/source-documents/${documentId}/pages/${page}`;

const view: StudyViewData = {
  schema: STUDY_VIEW_SCHEMA,
  sections: [
    {
      heading: "What the notices say",
      paragraphs: [
        {
          sentences: [
            { text: "The fee was raised.", factIds: ["F-aaaa0001-001", "F-bbbb0002-001"] },
            { text: "No source for this one.", factIds: ["F-unknown"] },
          ],
        },
      ],
    },
  ],
  blocks: [
    {
      name: "spine_table",
      rows: [
        {
          id: "S1",
          label: "Monthly fee",
          status: "SUPERSEDED",
          values: [
            {
              factId: "F-aaaa0001-001",
              valueAsWritten: "$ 1,200.00 / mo.",
              sourceRef: { sourceDocumentId: DOC_A, pageNumber: 2, quote: "Fee: $ 1,200.00 / mo." },
            },
          ],
        },
      ],
    },
    {
      name: "documents",
      rows: [
        { id: DOC_A, role: "ANCHOR", typeInPlainWords: "Notice", date: "2026-01-05", values: [] },
        { id: DOC_B, role: "SUPPORTING", typeInPlainWords: "Letter", values: [] },
      ],
    },
    { name: "conflicts", rows: [] },
    {
      name: "gaps",
      rows: [{ id: "X1", statement: "The signed agreement was not supplied.", values: [] }],
    },
  ],
};

const sources: StudyViewSources = {
  documents: { [DOC_A]: { fileName: "notice.pdf" }, [DOC_B]: { fileName: "letter.pdf" } },
  facts: {
    "F-aaaa0001-001": { sourceDocumentId: DOC_A, pageNumber: 2, quote: "Fee: $ 1,200.00 / mo." },
    "F-bbbb0002-001": { sourceDocumentId: DOC_B, pageNumber: 4, quote: "The fee is now higher." },
  },
};

afterEach(cleanup);

describe("StudyView", () => {
  it("renders narrative sections first, then non-empty blocks in the order the view gives", () => {
    render(<StudyView hiveId={HIVE_ID} revisionFormat="canonical-study-1" view={view} sources={sources} />);
    const root = screen.getByTestId("study-view");
    const headings = within(root).getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(["What the notices say", "What the documents establish", "Documents", "What is missing"]);
    expect(within(root).getAllByTestId("study-view-block").map((block) => block.dataset.block)).toEqual([
      "spine_table",
      "documents",
      "gaps",
    ]);
    expect(screen.getByText("The signed agreement was not supplied.")).toBeTruthy();
    expect(screen.getByText("Not found in the documents that were read.")).toBeTruthy();
  });

  it("shows each value exactly as written", () => {
    render(<StudyView hiveId={HIVE_ID} revisionFormat="canonical-study-1" view={view} sources={sources} />);
    expect(screen.getAllByTestId("study-value").map((value) => value.textContent)).toEqual(["$ 1,200.00 / mo."]);
    expect(screen.getByText("superseded")).toBeTruthy();
  });

  it("links every cited sentence, value and document row to its physical page in a new tab", () => {
    render(<StudyView hiveId={HIVE_ID} revisionFormat="canonical-study-1" view={view} sources={sources} />);
    const sentences = screen.getAllByTestId("study-sentence");
    expect(sentences).toHaveLength(1);
    const sentenceLinks = within(sentences[0]!).getAllByRole("link");
    expect(sentenceLinks.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["notice.pdf p.2", pageUrl(DOC_A, 2)],
      ["letter.pdf p.4", pageUrl(DOC_B, 4)],
    ]);
    for (const link of sentenceLinks) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
    }
    expect(screen.queryByText("No source for this one.")).toBeNull();

    const spineRow = document.querySelector('[data-row-id="S1"]') as HTMLElement;
    expect(within(spineRow).getByRole("link").getAttribute("href")).toBe(pageUrl(DOC_A, 2));
    const documentRow = document.querySelector(`[data-row-id="${DOC_B}"]`) as HTMLElement;
    expect(within(documentRow).getByText("letter.pdf")).toBeTruthy();
    expect(within(documentRow).getByRole("link").getAttribute("href")).toBe(pageUrl(DOC_B, 1));
  });

  it("shows a Rebuild notice instead of a view for investigation-1 revisions", () => {
    render(<StudyView hiveId={HIVE_ID} revisionFormat="investigation-1" view={view} sources={sources} />);
    expect(screen.getByTestId("study-legacy-notice")).toBeTruthy();
    expect(screen.getByTestId("study-legacy-rebuild").getAttribute("href")).toBe(`/hives/${HIVE_ID}/documents`);
    expect(screen.queryByTestId("study-view")).toBeNull();
  });

  it("treats a revision without a format as investigation-1", () => {
    render(<StudyView hiveId={HIVE_ID} revisionFormat={undefined} view={null} sources={null} />);
    expect(screen.getByTestId("study-legacy-notice")).toBeTruthy();
  });

  it("says the view is not written yet when a canonical revision has no study view", () => {
    render(<StudyView hiveId={HIVE_ID} revisionFormat="canonical-study-1" view={null} sources={null} />);
    expect(screen.getByTestId("study-view-pending")).toBeTruthy();
  });
});
