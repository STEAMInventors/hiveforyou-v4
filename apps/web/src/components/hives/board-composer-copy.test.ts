import { describe, expect, it } from "vitest";

import { assistantComposerHint, conversationComposerPlaceholder } from "@/components/hives/board-composer-copy";

describe("conversationComposerPlaceholder", () => {
  it("uses the team placeholder when the client has no assignee", () => {
    expect(
      conversationComposerPlaceholder({
        viewerIsClient: true,
        clientName: "Ruth Ortiz",
        clientAuthorName: null,
        teamMemberFirstName: null,
      }),
    ).toBe("Write to the team…");
  });

  it("uses the assignee first name when one is set", () => {
    expect(
      conversationComposerPlaceholder({
        viewerIsClient: true,
        clientName: "Ruth Ortiz",
        clientAuthorName: null,
        teamMemberFirstName: "Priya Shah",
      }),
    ).toBe("Write to Priya…");
  });
});

describe("assistantComposerHint", () => {
  it("uses the firm team hint when the client has no assignee", () => {
    expect(
      assistantComposerHint({
        staffView: false,
        viewerIsClient: true,
        firmless: false,
        assistantName: "Maya",
        teamMemberFirstName: null,
      }),
    ).toBe("Only you and the firm's team can see your questions.");
  });

  it("uses the assignee team hint when one is set", () => {
    expect(
      assistantComposerHint({
        staffView: false,
        viewerIsClient: true,
        firmless: false,
        assistantName: "Maya",
        teamMemberFirstName: "Priya",
      }),
    ).toBe("Only you and Priya's team can see your questions.");
  });
});