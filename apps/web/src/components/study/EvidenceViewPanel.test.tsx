// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111",
  useSearchParams: () => new URLSearchParams(),
}));

import { ChatSheet } from "@/components/hives/ChatSheet";
import { ChatWrap, HIVE_ID, chatConfig, installChatFetch, loadOf } from "@/components/hives/ask-chat-fixtures";

import { EvidenceViewPanel } from "./EvidenceViewPanel";

function panel(over: { showAskClient?: boolean } = {}) {
  return (
    <EvidenceViewPanel
      hiveId={HIVE_ID}
      backLabel="Home"
      docRole="Bank statement"
      docSub="PDF · 2023"
      pageNumber={3}
      totalPages={8}
      statement={
        {
          headline: "The balance fell in March.",
          status: "checked",
          whyItMatters: null,
          pageSupports: null,
          documentsDontSay: null,
          pageButtons: [],
          conflictRow: null,
          spineRow: null,
          gapText: null,
          openItem: null,
          askClientQuestion: "Can you send the March statement?",
        } as never
      }
      chip={{ sourceDocumentId: "doc-1", pageNumber: 3 }}
      signedUrl={null}
      pageText={null}
      loadError={null}
      pdfViewerLoadError={false}
      highlightStatusLine={null}
      quoteForHighlight=""
      isPdf={false}
      isImage={false}
      PdfViewer={null}
      neighborPageText={null}
      originalPageHref={undefined}
      onHighlightStatus={vi.fn()}
      onPageChange={vi.fn()}
      onOpenChip={vi.fn()}
      onClose={vi.fn()}
      showAskClient={over.showAskClient ?? false}
      clientFirstName="Dana"
      unreadableProblem={null}
    />
  );
}

beforeEach(() => {
  installChatFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EvidenceViewPanel: Ask about this page", () => {
  it("opens the chat sheet with the composer prefilled and the caret at the end", async () => {
    render(
      <ChatWrap config={chatConfig()}>
        {panel()}
        <ChatSheet />
      </ChatWrap>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask Rowan about this page" }));

    expect(screen.getByRole("dialog", { name: "Ask Rowan" })).toBeTruthy();
    const area = screen.getByRole("textbox", { name: /Question for Rowan/ }) as HTMLTextAreaElement;
    await waitFor(() => expect(area.value).toBe("About the Bank statement page 3: "));
    await waitFor(() => expect(document.activeElement).toBe(area));
    expect(area.selectionStart).toBe(area.value.length);
  });

  it("sits beside, not instead of, 'Ask <client> about it' for staff", () => {
    render(
      <ChatWrap config={chatConfig()}>{panel({ showAskClient: true })}</ChatWrap>,
    );
    expect(screen.getByRole("link", { name: "Ask Dana about it" })).toBeTruthy();
    expect(screen.getByTestId("evidence-ask-assistant")).toBeTruthy();
  });

  it("is hidden when the assistant is off for the hive", () => {
    render(
      <ChatWrap config={chatConfig({ initialAssistant: loadOf([], { assistantRepliesOn: false }) })}>
        {panel()}
      </ChatWrap>,
    );
    expect(screen.queryByTestId("evidence-ask-assistant")).toBeNull();
    expect(screen.queryByRole("button", { name: /about this page/ })).toBeNull();
  });

  it("is hidden outside a hive chat", () => {
    render(panel());
    expect(screen.queryByTestId("evidence-ask-assistant")).toBeNull();
  });
});
