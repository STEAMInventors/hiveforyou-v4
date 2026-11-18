// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NewClientHiveForm } from "./NewClientHiveForm";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

const packCatalog = [
  {
    id: "widget-review",
    version: 2,
    title: "Widget review pack",
    rows: [
      {
        key: "pay stubs",
        title: "Pay stubs",
        sourceLabel: null,
        group: "client" as const,
        defaultTicked: true,
        custom: false,
      },
      {
        key: "lender letter",
        title: "Lender letter",
        sourceLabel: "the lender",
        group: "other" as const,
        defaultTicked: false,
        custom: false,
      },
    ],
  },
];

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("NewClientHiveForm", () => {
  it("prefills name and validates invite mode", () => {
    render(<NewClientHiveForm packCatalog={packCatalog} initialName="Ruth" />);
    expect((screen.getByLabelText(/Client's name/i) as HTMLInputElement).value).toBe("Ruth");
    fireEvent.click(screen.getByRole("button", { name: "Invite Ruth to upload" }));
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
  });

  it("submits documents mode to the new-client route", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ ok: true, hiveId: "550e8400-e29b-41d4-a716-446655440000", mode: "documents" }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<NewClientHiveForm packCatalog={packCatalog} />);
    fireEvent.change(screen.getByLabelText(/Client's name/i), { target: { value: "Ruth" } });
    fireEvent.click(screen.getByRole("button", { name: "I have their documents" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(init?.headers?.["Idempotency-Key"] ?? (init as RequestInit).headers)).toBeTruthy();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hives/550e8400-e29b-41d4-a716-446655440000/documents"));
  });

  it("hides the checklist when Something else is chosen", () => {
    const wideCatalog = [
      ...packCatalog,
      {
        id: "other-pack",
        version: 1,
        title: "Other pack",
        rows: [{ key: "id", title: "ID", sourceLabel: null, group: "client" as const, defaultTicked: true, custom: false }],
      },
    ];
    render(<NewClientHiveForm packCatalog={wideCatalog} firmPracticeAreas={["widget-review", "other-pack"]} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(screen.queryByText(/What to ask/i)).toBeNull();
    expect(screen.getByText("No checklist")).toBeTruthy();
  });
});