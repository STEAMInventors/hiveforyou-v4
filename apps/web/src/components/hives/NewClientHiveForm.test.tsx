// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewClientHiveForm } from "./NewClientHiveForm";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const uploadSelectedSourceFiles = vi.fn(async () => ({ allSettled: true }));
vi.mock("@/components/hives/source-file-upload", async () => {
  const actual = await vi.importActual<typeof import("@/components/hives/source-file-upload")>(
    "@/components/hives/source-file-upload",
  );
  return {
    ...actual,
    uploadSelectedSourceFiles: (...args: unknown[]) => uploadSelectedSourceFiles(...args),
  };
});

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
  HiveClientError: class HiveClientError extends Error {
    constructor(message: string) {
      super(message);
    }
  },
}));

vi.mock("@/lib/source-documents-client", () => ({
  fetchUploadQuota: vi.fn(async () => ({ quota: { remaining: 10, limit: 10 } })),
  startDocumentReads: vi.fn(async () => ({})),
}));

afterEach(async () => {
  cleanup();
  push.mockReset();
  uploadSelectedSourceFiles.mockClear();
  const { createHive } = await import("@/lib/hives-client");
  vi.mocked(createHive).mockClear();
});

describe("NewClientHiveForm", () => {
  it("validates the client name", () => {
    render(<NewClientHiveForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create hive" }));
    expect(screen.getByText("Enter the client's name.")).toBeTruthy();
  });

  it("creates a client hive with no files", async () => {
    const { createHive } = await import("@/lib/hives-client");
    const { startDocumentReads } = await import("@/lib/source-documents-client");
    render(<NewClientHiveForm />);
    const [nameInput, aboutInput] = screen.getAllByRole("textbox");
    fireEvent.change(nameInput, { target: { value: "Alex" } });
    fireEvent.change(aboutInput, { target: { value: "Benefits" } });
    fireEvent.click(screen.getByRole("button", { name: "Create hive" }));
    await waitFor(() => {
      expect(createHive).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Alex",
          description: "Benefits",
          kind: "client",
        }),
      );
    });
    expect(uploadSelectedSourceFiles).not.toHaveBeenCalled();
    expect(startDocumentReads).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/hives/550e8400-e29b-41d4-a716-446655440000/documents");
    });
  });

  it("uploads valid files and starts reading", async () => {
    const { startDocumentReads } = await import("@/lib/source-documents-client");
    render(<NewClientHiveForm />);
    const [nameInput] = screen.getAllByRole("textbox");
    fireEvent.change(nameInput, { target: { value: "Alex" } });
    const file = new File(["%PDF"], "notice.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Create hive and read 1 document" }));
    await waitFor(() => expect(uploadSelectedSourceFiles).toHaveBeenCalled());
    await waitFor(() => expect(startDocumentReads).toHaveBeenCalled());
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("blocks submit when every chosen file is invalid", async () => {
    const { createHive } = await import("@/lib/hives-client");
    render(<NewClientHiveForm />);
    const [nameInput] = screen.getAllByRole("textbox");
    fireEvent.change(nameInput, { target: { value: "Alex" } });
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Create hive" }));
    expect(screen.getByText("Remove the files that aren't supported.")).toBeTruthy();
    expect(createHive).not.toHaveBeenCalled();
  });

  it("still opens the hive when an upload fails", async () => {
    uploadSelectedSourceFiles.mockResolvedValueOnce({ allSettled: false });
    render(<NewClientHiveForm />);
    const [nameInput] = screen.getAllByRole("textbox");
    fireEvent.change(nameInput, { target: { value: "Alex" } });
    const file = new File(["%PDF"], "notice.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Create hive and read 1 document" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hives/550e8400-e29b-41d4-a716-446655440000/documents"));
  });
});