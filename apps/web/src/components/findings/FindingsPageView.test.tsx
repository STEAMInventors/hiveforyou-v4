// @vitest-environment jsdom
import { bankruptcyC13Fixture } from "@/components/study/fixtures/bankruptcy-c13";
import { buildFindingsOpenItems, buildFindingsTopics, findingsOpenItemCount } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolvedFindingsStorageKey } from "./FindingsReviewDrawer";
import { FindingsPageView } from "./FindingsPageView";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("FindingsPageView review flow", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ signedUrl: "https://example.com/page.pdf", mimeType: "application/pdf" }), { status: 200 })),
    );
  });

  it("opens the review drawer and decrements the open count when marked reviewed", () => {
    const fixture = bankruptcyC13Fixture("PRO");
    const openItems = buildFindingsOpenItems(fixture.view, fixture.canonicalStudy);
    const topicBundle = buildFindingsTopics({ view: fixture.view, canonicalStudy: fixture.canonicalStudy, pack: null, openItems });
    render(
      <FindingsPageView
        hiveId={HIVE_ID}
        revisionNumber={3}
        view={fixture.view}
        sources={fixture.sources}
        canonicalStudy={fixture.canonicalStudy}
        pack={null}
        topics={topicBundle.topics}
        otherOpenItems={topicBundle.otherOpenItems}
        glanceMetrics={[]}
        openItemCount={findingsOpenItemCount(openItems)}
        allOpenItemIds={openItems.map((item) => item.id)}
        coverageGaps={[]}
        preparation={null}
      />,
    );
    const initial = screen.getByTestId("findings-open-count").textContent ?? "";
    const review = screen.getAllByRole("button", { name: "Review context" })[0]!;
    fireEvent.click(review);
    expect(screen.getByTestId("findings-review-drawer")).toBeTruthy();
    fireEvent.click(screen.getByTestId("findings-mark-reviewed"));
    const after = screen.getByTestId("findings-open-count").textContent ?? "";
    expect(after).not.toBe(initial);
    const stored = sessionStorage.getItem(resolvedFindingsStorageKey(HIVE_ID));
    expect(stored).toBeTruthy();
  });
});