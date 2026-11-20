// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/hives/HiveConversation", () => ({
  HiveConversation: () => <div data-testid="client-messages-mock" />,
}));

import { ClientHome } from "./ClientHome";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => cleanup());

describe("ClientHome", () => {
  it("renders the phone-first layout without staff tabs", () => {
    render(
      <ClientHome
        hiveId={HIVE_ID}
        hiveTitle="Ruth Ortiz"
        staffDisplayName="Priya Shah"
        staffTitle="Attorney"
        assistantName="Rowan"
        checklist={[
          {
            gapId: "g1",
            title: "2023 bank statements",
            status: "not_in",
            statusText: "Not in yet.",
          },
        ]}
        progress={{ in: 2, total: 3 }}
        openItems={[]}
        initialDocuments={[]}
        acceptedStudyRevisionId="rev-1"
        initialPeople={{ ok: true, page: { messages: [] } }}
        currentUserId="user"
        hiveFirmId="22222222-2222-4222-8222-222222222222"
        loadError={null}
        view={null}
        sources={null}
        canonicalStudy={null}
        coverageGaps={[]}
        topics={[]}
      />,
    );

    expect(screen.getByTestId("client-home")).toBeTruthy();
    expect(screen.getByText("Your file with")).toBeTruthy();
    expect(screen.getByText("Priya Shah")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Ruth Ortiz" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ask Rowan about your documents/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Your documents" }).getAttribute("href")).toBe(`/hives/${HIVE_ID}/documents`);
    expect(screen.queryByTestId("hive-head")).toBeNull();
  });
});