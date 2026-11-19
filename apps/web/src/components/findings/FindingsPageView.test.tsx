// @vitest-environment jsdom
import type { CanonicalStudy, StudyView, StudyViewSources } from "@hiveforyou/contracts";
import { buildFindingsOpenItems, buildFindingsTopics } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/hives/x/findings",
  useSearchParams: () => new URLSearchParams(),
}));

import { FindingsPageView } from "./FindingsPageView";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

const view: StudyView = {
  schema: "hive.study-view/1",
  sections: [],
  blocks: [
    {
      name: "spine_table",
      rows: [
        {
          id: "row-1",
          label: "Account balance",
          status: "PARTLY_SHOWN",
          values: [
            {
              factId: "f-1",
              valueAsWritten: "$1,200.00",
              sourceRef: { sourceDocumentId: "doc-1", pageNumber: 1, quote: "$1,200.00" },
            },
          ],
        },
      ],
    },
    {
      name: "conflicts",
      rows: [
        {
          id: "c-1",
          statement: "Two balances differ",
          status: "CONFLICTED",
          values: [
            {
              factId: "f-2",
              valueAsWritten: "$1,100.00",
              sourceRef: { sourceDocumentId: "doc-1", pageNumber: 2, quote: "$1,100.00" },
            },
            {
              factId: "f-3",
              valueAsWritten: "$1,300.00",
              sourceRef: { sourceDocumentId: "doc-2", pageNumber: 1, quote: "$1,300.00" },
            },
          ],
        },
      ],
    },
  ],
  components: [],
};

const canonicalStudy: CanonicalStudy = {
  schema: "hive.canonical-study/1",
  documents: [],
  spine: [],
  outsideSpine: [],
  conflicts: [],
  timeline: [],
  gaps: [],
  domainLabel: "synthetic",
  spineSource: null,
};

const sources: StudyViewSources = {
  facts: {
    "f-1": { sourceDocumentId: "doc-1", pageNumber: 1, quote: "$1,200.00" },
    "f-2": { sourceDocumentId: "doc-1", pageNumber: 2, quote: "$1,100.00" },
    "f-3": { sourceDocumentId: "doc-2", pageNumber: 1, quote: "$1,300.00" },
  },
};

function renderFindingsPage() {
  const openItems = buildFindingsOpenItems(view, canonicalStudy);
  const topicBundle = buildFindingsTopics({ view, canonicalStudy, pack: null, openItems });
  const openItemCount = openItems.length;
  render(
    <FindingsPageView
      hiveId={HIVE_ID}
      revisionNumber={3}
      view={view}
      sources={sources}
      canonicalStudy={canonicalStudy}
      pack={null}
      topics={topicBundle.topics}
      otherOpenItems={topicBundle.otherOpenItems}
      glanceMetrics={[]}
      openItemCount={openItemCount}
      coverageGaps={[]}
      preparation={null}
    />,
  );
  return { openItems, openItemCount };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ signedUrl: "https://example.com/page.pdf", mimeType: "application/pdf" }), {
        status: 200,
      }),
    ),
  );
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("FindingsPageView review flow", () => {
  it("opens the review drawer with spine context, source chips, and comparison for conflicts", () => {
    const { openItems } = renderFindingsPage();
    const spineItem = openItems.find((item) => item.id.startsWith("spine-"));
    expect(spineItem).toBeTruthy();
    const spineButton = document.querySelector<HTMLButtonElement>(`button[data-review-id="${spineItem!.id}"]`);
    expect(spineButton).toBeTruthy();
    fireEvent.click(spineButton!);

    const drawer = screen.getByTestId("findings-review-drawer");
    expect(within(drawer).getByText(spineItem!.question)).toBeTruthy();
    expect(within(drawer).getByTestId("establish-table")).toBeTruthy();
    expect(within(drawer).getAllByTestId("source-chip").length).toBeGreaterThan(0);

    fireEvent.click(within(drawer).getByRole("button", { name: "Close review" }));

    const conflictItem = openItems.find((item) => item.id.startsWith("conflict-"));
    expect(conflictItem).toBeTruthy();
    const conflictButton = document.querySelector<HTMLButtonElement>(`button[data-review-id="${conflictItem!.id}"]`);
    fireEvent.click(conflictButton!);
    expect(within(screen.getByTestId("findings-review-drawer")).getAllByTestId("comparison-card").length).toBeGreaterThan(0);
  });

  it("closes from the footer Close control without changing the server open count", async () => {
    const { openItemCount } = renderFindingsPage();
    const reviewButton = screen.getAllByRole("button", { name: "Review context" })[0]!;
    fireEvent.click(reviewButton);

    const drawer = screen.getByTestId("findings-review-drawer");
    fireEvent.click(within(drawer).getByRole("button", { name: "Close review" }));

    expect(screen.queryByTestId("findings-review-drawer")).toBeNull();
    expect(screen.getByTestId("findings-open-count").textContent).toBe(`${openItemCount} to review`);
    expect(sessionStorage.length).toBe(0);
    await waitFor(() => {
      expect(document.activeElement).toBe(reviewButton);
    });
  });

  it("closes on Escape and returns focus to the review trigger", async () => {
    renderFindingsPage();
    const reviewButton = screen.getAllByRole("button", { name: "Review context" })[0]!;
    fireEvent.click(reviewButton);
    expect(screen.getByTestId("findings-review-drawer")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByTestId("findings-review-drawer")).toBeNull();
    expect(sessionStorage.length).toBe(0);
    await waitFor(() => {
      expect(document.activeElement).toBe(reviewButton);
    });
  });

  it("closes when the backdrop is clicked", async () => {
    renderFindingsPage();
    const reviewButton = screen.getAllByRole("button", { name: "Review context" })[0]!;
    fireEvent.click(reviewButton);

    fireEvent.click(screen.getByTestId("findings-review-backdrop"));

    expect(screen.queryByTestId("findings-review-drawer")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(reviewButton);
    });
  });
});