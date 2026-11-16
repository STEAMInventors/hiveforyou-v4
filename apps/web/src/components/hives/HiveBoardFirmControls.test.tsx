// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HiveBoardFirmControls } from "./HiveBoardFirmControls";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const hive = {
  id: "f1100030-0000-4000-8000-000000000001",
  hiveId: "f1100030-0000-4000-8000-000000000001",
  name: "Client",
  description: null,
  kind: "client" as const,
  clientRequestId: "f1100020-0000-4000-8000-000000000001",
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
  firmId: "f1100010-0000-4000-8000-0000000000ab",
  stage: "open" as const,
};

const firm = {
  firm: {
    firmId: "f1100010-0000-4000-8000-0000000000ab",
    name: "Rivera Law",
    callerRole: "owner" as const,
  },
  members: [
    {
      userId: "f1100010-0000-4000-8000-0000000000aa",
      email: "owner@example.test",
      role: "owner" as const,
      title: "Attorney",
      state: "active",
      joined: true,
      displayName: "Dana",
    },
  ],
  pendingInvitations: [],
};

describe("HiveBoardFirmControls", () => {
  it("renders team assignment controls for firm hives", () => {
    render(<HiveBoardFirmControls hive={hive} currentUserId={firm.members[0].userId ?? null} firm={firm} />);
    expect(screen.getByTestId("hive-board-firm-controls")).toBeTruthy();
    expect(screen.getByText("Assigned to")).toBeTruthy();
    expect(screen.getByText("Take this hive")).toBeTruthy();
  });
});