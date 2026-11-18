// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FirmSetupForm } from "./FirmSetupForm";

afterEach(() => cleanup());

describe("FirmSetupForm", () => {
  it("requires a first name, firm name, and a practice area or request text", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onFinished = vi.fn();
    const practiceAreaOptions = [
      { packId: "pack-alpha", label: "Intake pack A", description: "Documents gathered before filing." },
    ];
    render(<FirmSetupForm defaultFirstName="" practiceAreaOptions={practiceAreaOptions} onFinished={onFinished} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter your first name.");

    fireEvent.change(screen.getByLabelText("Your first name"), { target: { value: "Dana" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter your firm or practice name.");

    fireEvent.change(screen.getByLabelText(/Firm or practice name/), { target: { value: "Rivera Law" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Choose what you handle/);

    fetchMock.mockResolvedValueOnce({ ok: true });
    fireEvent.click(screen.getByTestId("practice-area-pack-alpha"));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});