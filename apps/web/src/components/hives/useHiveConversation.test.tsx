// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { HiveConversation } from "@/components/hives/HiveConversation";
import type { ConversationLoad } from "@/components/hives/useHiveConversation";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

const emptyPage: ConversationLoad = {
  ok: true,
  page: {
    messages: [],
    participantRoleLabels: [],
    participantCount: 0,
    viewerLastReadAt: null,
    nextCursor: null,
  },
};

afterEach(() => cleanup());

describe("useHiveConversation assistant name", () => {
  it("prefers the prop over the HiveForYou default when the page has no assistantName", () => {
    render(
      <HiveConversation
        hiveId={HIVE_ID}
        initial={emptyPage}
        staffView={false}
        clientName={null}
        viewerIsClient
        mode="assistant"
        assistantName="Sarah"
      />,
    );
    expect(screen.getByPlaceholderText("Ask Sarah about the documents…")).toBeTruthy();
  });
});