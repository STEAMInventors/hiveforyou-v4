// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/auth/auth-actions", () => ({ signOutAction: vi.fn() }));

import { FirmInviteAcceptPanel } from "./FirmInviteAcceptPanel";

afterEach(() => cleanup());

const lookup = {
  status: "valid" as const,
  email: "dana@example.com",
  firmName: "Rivera Law",
  title: "Paralegal",
  role: "member" as const,
};

describe("FirmInviteAcceptPanel", () => {
  it("refuses used, revoked, expired, and mismatched invitations", () => {
    for (const mode of ["used", "revoked", "expired", "invalid"] as const) {
      render(<FirmInviteAcceptPanel mode={mode} />);
      expect(screen.getByTestId(`firm-invite-${mode}`)).toBeTruthy();
      expect(screen.getByRole("heading", { name: "This link cannot be used" })).toBeTruthy();
      cleanup();
    }

    render(
      <FirmInviteAcceptPanel
        mode="wrong_email"
        invitedEmail="dana@example.com"
        sessionEmail="other@example.com"
      />,
    );
    expect(screen.getByText(/dana@example.com/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("accepts a matching invitation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ firmId: "f" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<FirmInviteAcceptPanel mode="welcome" token={"a".repeat(64)} lookup={lookup} />);
    fireEvent.click(screen.getByRole("button", { name: "Join the team" }));
    await screen.findByRole("button", { name: "Joining…" }).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalled();
    const acceptCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("firm-invitations/accept"));
    expect(acceptCall).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
