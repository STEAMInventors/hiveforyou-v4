// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewClientHiveForm } from "./NewClientHiveForm";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/hives-client", () => ({
  createHive: vi.fn(async () => ({
    hive: {
      id: "550e8400-e29b-41d4-a716-446655440000",
      hiveId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Alex",
      description: "Benefits",
      kind: "client",
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-11-14T00:00:00.000Z",
      updatedAt: "2026-11-14T00:00:00.000Z",
    },
    created: true,
  })),
  HiveClientError: class extends Error {},
}));

afterEach(() => {
  cleanup();
});

describe("NewClientHiveForm", () => {
  it("validates the client name", () => {
    render(<NewClientHiveForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create hive and add documents" }));
    expect(screen.getByText("Enter the client's name.")).toBeTruthy();
  });

  it("creates a client hive", async () => {
    const { createHive } = await import("@/lib/hives-client");
    render(<NewClientHiveForm />);
    const [nameInput, aboutInput] = screen.getAllByRole("textbox");
    fireEvent.change(nameInput, { target: { value: "Alex" } });
    fireEvent.change(aboutInput, { target: { value: "Benefits" } });
    fireEvent.click(screen.getByRole("button", { name: "Create hive and add documents" }));
    await waitFor(() => {
      expect(createHive).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Alex",
          description: "Benefits",
          kind: "client",
        }),
      );
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/hives/550e8400-e29b-41d4-a716-446655440000/documents");
    });
  });
});