// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Hive } from "@hiveforyou/contracts";

import { HiveSectionTabs } from "./HiveSectionTabs";

const hive: Hive = {
  id: "11111111-1111-4111-8111-111111111111",
  hiveId: "11111111-1111-4111-8111-111111111111",
  name: "Client",
  kind: "client",
  firmId: "33333333-3333-4333-8333-333333333333",
  clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
});

describe("HiveSectionTabs", () => {
  it("exposes concept data-tab keys and keyboard tab order", () => {
    render(
      <HiveSectionTabs
        hive={hive}
        active="board"
        counts={{ toReviewCount: null, documents: 4, reports: null, teamNotes: null, unreadMessages: null }}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("data-tab"))).toEqual([
      "home",
      "documents",
      "report",
      "audit",
      "notes",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
  });
});
