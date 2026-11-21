// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HivesLeftMenu } from "./HivesLeftMenu";

afterEach(() => {
  cleanup();
});

describe("HivesLeftMenu", () => {
  it("marks the active queue with aria-current and data-queue", () => {
    const onSelect = vi.fn();
    render(
      <HivesLeftMenu
        firmName="Example Law Group"
        personLine="Priya Shah"
        queue="mine"
        counts={{ all: 5, mine: 2, unassigned: 1, own: 1, needs: 0, ready: 0 }}
        showMine
        showUnassigned
        showYourOwn
        searchActive={false}
        onSelectQueue={onSelect}
      />,
    );
    const mine = screen.getByRole("button", { name: /Mine/ });
    expect(mine.getAttribute("data-queue")).toBe("mine");
    expect(mine.getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: /Unassigned/ }));
    expect(onSelect).toHaveBeenCalledWith("unassigned");
  });
});