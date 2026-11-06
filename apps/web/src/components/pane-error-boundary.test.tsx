// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { PaneErrorBoundary } from "./pane-error-boundary";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

let shouldThrow = true;
function Exploding() {
  if (shouldThrow) throw new Error("Cannot read properties of undefined (reading 'rows')");
  return <p>Study content</p>;
}

beforeEach(() => {
  shouldThrow = true;
  refresh.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PaneErrorBoundary", () => {
  it("shows the calm branded message and support reference when a pane throws while rendering", () => {
    render(
      <PaneErrorBoundary hiveId={HIVE_ID} supportReference="req-123">
        <Exploding />
      </PaneErrorBoundary>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("We couldn't show this. Try again, or rebuild the study.");
    expect(alert.textContent).toContain("Support reference: req-123");
    expect(alert.textContent).not.toContain("Cannot read properties");
    expect(screen.getByRole("link", { name: "Rebuild the study from Documents" }).getAttribute("href")).toBe(
      `/hives/${HIVE_ID}/documents`,
    );
  });

  it("never logs the error message, which can carry document text", () => {
    const errorSpy = vi.mocked(console.error);
    render(
      <PaneErrorBoundary hiveId={HIVE_ID}>
        <Exploding />
      </PaneErrorBoundary>,
    );
    const ours = errorSpy.mock.calls.filter((call) => call[0] === "Hive pane failed to render");
    expect(ours).toHaveLength(1);
    expect(ours[0]!.join(" ")).not.toContain("reading 'rows'");
  });

  it("tries again by re-rendering and refreshing the page data", () => {
    render(
      <PaneErrorBoundary hiveId={HIVE_ID} supportReference="req-123">
        <Exploding />
      </PaneErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Study content")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
