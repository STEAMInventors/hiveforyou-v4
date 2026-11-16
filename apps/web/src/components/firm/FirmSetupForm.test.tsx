// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FirmSetupForm } from "./FirmSetupForm";

afterEach(() => cleanup());

describe("FirmSetupForm", () => {
  it("requires a firm name, a valid teammate email, and a short assistant name", () => {
    render(<FirmSetupForm onFinished={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter your firm’s name.");

    fireEvent.change(screen.getByLabelText("Firm name"), { target: { value: "Rivera Law" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("alert").textContent).toBe("Check the email “not-an-email”.");

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    fireEvent.change(screen.getByLabelText("Assistant’s name"), { target: { value: "S".repeat(41) } });
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.getByRole("alert").textContent).toBe("Use 1 to 40 characters.");
  });
});
