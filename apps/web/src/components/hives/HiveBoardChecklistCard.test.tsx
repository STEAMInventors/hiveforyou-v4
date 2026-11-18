// @vitest-environment jsdom
import type { HiveBoardModel } from "@hiveforyou/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HiveBoardChecklistCard } from "./HiveBoardChecklistCard";

afterEach(() => cleanup());

const board = {
  progress: { in: 1, total: 2 },
  checklistNote: "",
  checklist: [
    {
      gapId: "g1",
      title: "Current lease",
      status: "in",
      statusText: "",
      action: { label: "Add it", href: null },
    },
    {
      gapId: "g2",
      title: "Last two pay stubs",
      status: "not_in",
      statusText: "",
      action: { label: "Add it", href: "/hives/h/documents?upload=g2" },
    },
  ],
} as unknown as HiveBoardModel;

describe("HiveBoardChecklistCard on Documents", () => {
  it("is titled What we asked for and is the #requested target", () => {
    const { container } = render(<HiveBoardChecklistCard board={board} />);
    const card = container.querySelector("#requested") as HTMLElement;
    expect(card).toBeTruthy();
    expect(within(card).getByRole("heading", { name: "What we asked for" })).toBeTruthy();
    expect(within(card).getByText("1 of 2 in")).toBeTruthy();
    expect(within(card).getByText("Current lease")).toBeTruthy();
    const add = within(card).getByRole("link", { name: "Add it" });
    expect(add.getAttribute("href")).toBe("/hives/h/documents?upload=g2");
    expect(screen.queryByText("Items")).toBeNull();
  });
});
