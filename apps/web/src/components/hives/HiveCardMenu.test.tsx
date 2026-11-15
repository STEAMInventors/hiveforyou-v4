// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HiveCardMenu } from "./HiveCardMenu";

vi.mock("@/lib/hives-client", () => ({
  setHiveKind: vi.fn(async () => undefined),
  HiveClientError: class extends Error {},
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HiveCardMenu", () => {
  it("calls set_hive_kind when moving to client hives", async () => {
    const onKindChanged = vi.fn();
    const { setHiveKind } = await import("@/lib/hives-client");
    render(
      <HiveCardMenu
        hiveId="550e8400-e29b-41d4-a716-446655440000"
        hiveName="Example"
        hiveKind="own"
        onDeleteHive={() => undefined}
        onKindChanged={onKindChanged}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Options for Example" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to client hives" }));
    await waitFor(() => {
      expect(setHiveKind).toHaveBeenCalledWith("550e8400-e29b-41d4-a716-446655440000", "client");
      expect(onKindChanged).toHaveBeenCalled();
    });
  });
});