// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const createIntentRequest = vi.fn();
vi.mock("@/lib/source-documents-client", () => ({
  createIntentRequest: (...args: unknown[]) => createIntentRequest(...args),
}));

import { HiveWorkspaceAsk } from "./hive-ask-input";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  createIntentRequest.mockReset();
});

describe("HiveWorkspaceAsk", () => {
  it("has no magnifier, saves on Add question, and shows the study-build status", async () => {
    createIntentRequest.mockResolvedValue({});
    render(<HiveWorkspaceAsk hiveId={HIVE_ID} hiveName="Widget batch review" />);

    expect(document.querySelector("svg circle")).toBeNull();
    const input = screen.getByLabelText("Add a question for the next study build");
    fireEvent.change(input, { target: { value: "What changed in March?" } });
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));

    await waitFor(() => expect(createIntentRequest).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status").textContent).toBe(
      "Saved. Your next study build uses this question.",
    );
    const pill = screen.getByTestId("hive-header-ask-pill");
    expect(within(pill).getByText("Widget batch review")).toBeTruthy();
  });

  it("clears the Saved line after four seconds", async () => {
    vi.useFakeTimers();
    try {
      createIntentRequest.mockResolvedValue({});
      render(<HiveWorkspaceAsk hiveId={HIVE_ID} hiveName="Widget batch review" />);
      const input = screen.getByLabelText("Add a question for the next study build");
      fireEvent.change(input, { target: { value: "What changed in March?" } });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Add question" }));
        await Promise.resolve();
      });
      expect(screen.getByRole("status")).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});