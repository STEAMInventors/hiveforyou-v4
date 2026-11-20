import { describe, expect, it } from "vitest";

import { hiveBoardPageDescription } from "@/lib/hives/board-head-copy";

describe("hiveBoardPageDescription", () => {
  it("describes a team conversation when the client has no assignee", () => {
    expect(
      hiveBoardPageDescription({
        firmless: false,
        view: "conversation",
        assistantName: "Maya",
        viewerIsClient: true,
        clientName: "Ruth Ortiz",
        staffFirstName: null,
      }),
    ).toBe("Your conversation with the team. Maya doesn't take part here.");
  });

  it("describes the assignee when one is set", () => {
    expect(
      hiveBoardPageDescription({
        firmless: false,
        view: "conversation",
        assistantName: "Maya",
        viewerIsClient: true,
        clientName: "Ruth Ortiz",
        staffFirstName: "Priya",
      }),
    ).toBe("Your conversation with Priya. Maya doesn't take part here.");
  });
});