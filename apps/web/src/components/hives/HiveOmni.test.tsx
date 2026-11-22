// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push, replace: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111",
  useSearchParams: () => new URLSearchParams(),
}));

import { EMPTY_OMNI_CATALOG, useRegisterOmniCatalog, type OmniCatalog } from "@/components/ui/omni-catalog";

import { ChatSheet } from "./ChatSheet";
import { HiveOmni } from "./HiveOmni";
import { ChatWrap, chatConfig, installChatFetch, loadOf } from "./ask-chat-fixtures";

const CATALOG: OmniCatalog = {
  ...EMPTY_OMNI_CATALOG,
  suggestions: ["What is still to come?"],
  statements: [
    { id: "s1", text: "The monthly premium is $142.", topic: "Premiums", pageLabel: "p.2", ref: { sourceDocumentId: "doc-1", pageNumber: 2 } },
  ],
  openItems: [{ id: "i1", title: "Premium notice for 2023", kind: "missing", ref: null }],
  documents: [{ id: "d1", role: "Premium statement", typeLabel: "PDF", period: "2023", pages: 4, ref: null }],
};

function Publish({ catalog }: { catalog: OmniCatalog }) {
  useRegisterOmniCatalog(catalog);
  return null;
}

function setup(options: { audience?: "staff" | "client"; off?: boolean; catalog?: OmniCatalog } = {}) {
  const config = chatConfig({
    audience: options.audience ?? "staff",
    initialAssistant: loadOf([], { assistantRepliesOn: !options.off }),
  });
  return render(
    <ChatWrap config={config}>
      <Publish catalog={options.catalog ?? CATALOG} />
      <HiveOmni assistantName="Rowan" audience={options.audience ?? "staff"} />
      <ChatSheet />
    </ChatWrap>,
  );
}

const box = () => screen.getByRole("combobox");

beforeEach(() => {
  push.mockClear();
  installChatFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HiveOmni (find only)", () => {
  it("is labelled for finding, never for asking", () => {
    setup();
    expect(box().getAttribute("placeholder")).toBe("Find anything in this hive");
    cleanup();
    setup({ audience: "client" });
    expect(box().getAttribute("placeholder")).toBe("Find in your documents");
  });

  it("opens to one line and no answers, question history or suggestions", () => {
    setup();
    fireEvent.focus(box());

    expect(screen.getByTestId("omni-empty").textContent).toBe(
      "Type to find statements, open items and documents in this hive. To ask a question, use Rowan.",
    );
    expect(screen.queryByText("Your questions")).toBeNull();
    expect(screen.queryByText("What is still to come?")).toBeNull();
    expect(screen.queryByRole("button", { name: /New question/ })).toBeNull();
  });

  it("shows the three result groups with the Ask row last", () => {
    setup();
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: "premium" } });

    expect(screen.getByText("In the documents")).toBeTruthy();
    expect(screen.getByText("Open items")).toBeTruthy();
    expect(screen.getByText("Documents")).toBeTruthy();
    expect(screen.getByText("Still to come")).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options[options.length - 1]!.textContent).toContain("Ask Rowan: premium");
  });

  it("says nothing matches above the Ask row", () => {
    setup();
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: "zzzz" } });
    expect(screen.getByTestId("omni-no-matches").textContent).toBe("Nothing in this hive matches “zzzz”.");
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("opens the page behind a result", () => {
    setup();
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: "monthly" } });
    fireEvent.click(screen.getAllByRole("option")[0]!);
    expect(push).toHaveBeenCalledTimes(1);
    expect(String(push.mock.calls[0]![0])).toContain("source=");
    expect(screen.queryByTestId("omni-pop")).toBeNull();
  });

  it("posts the Ask row's text into the thread and opens the chat", async () => {
    const { state } = installChatFetch();
    setup();
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: "What is the premium?" } });

    fireEvent.click(screen.getByRole("option", { name: /Ask Rowan: What is the premium\?/ }));

    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]).toMatchObject({ channel: "assistant", body: "What is the premium?" });
    expect(screen.getByRole("dialog", { name: "Ask Rowan" })).toBeTruthy();
    expect(screen.queryByTestId("omni-pop")).toBeNull();
    expect((box() as HTMLInputElement).value).toBe("");
  });

  it("asks on Enter for a typed query when no result is highlighted", async () => {
    const { state } = installChatFetch();
    setup();
    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: "Where is page 2?" } });
    fireEvent.keyDown(box(), { key: "Enter" });

    await waitFor(() => expect(state.posts).toHaveLength(1));
    expect(state.posts[0]!.body).toBe("Where is page 2?");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("does not ask on Enter with nothing typed", () => {
    const { state } = installChatFetch();
    setup();
    fireEvent.focus(box());
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(state.posts).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape without reopening", () => {
    setup();
    box().focus();
    fireEvent.focus(box());
    expect(screen.getByTestId("omni-pop")).toBeTruthy();

    fireEvent.keyDown(box(), { key: "Escape" });

    expect(screen.queryByTestId("omni-pop")).toBeNull();
    expect(document.activeElement).not.toBe(box());
  });

  it("opens the chat for an older ?ask=1 link", async () => {
    const original = window.location.href;
    window.history.pushState({}, "", "/hives/x?ask=1");
    setup();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Ask Rowan" })).toBeTruthy());
    window.history.pushState({}, "", original);
  });

  it("with the assistant off: no mention of it, no Ask row, nothing opens", () => {
    const { state } = installChatFetch();
    setup({ off: true });
    fireEvent.focus(box());
    expect(screen.getByTestId("omni-empty").textContent).toBe(
      "Type to find statements, open items and documents in this hive.",
    );
    fireEvent.change(box(), { target: { value: "premium" } });
    expect(screen.queryByRole("option", { name: /Ask Rowan/ })).toBeNull();

    fireEvent.keyDown(box(), { key: "Enter" });
    expect(state.posts).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("matches authorized documents by fileName without calling the AI, while preserving the separate Ask row", () => {
    const { state } = installChatFetch();
    setup({
      catalog: {
        ...EMPTY_OMNI_CATALOG,
        documents: [
          {
            id: "doc-maya",
            role: "Annual progress report",
            typeLabel: "PDF",
            period: "Nov 2025",
            pages: 4,
            fileName: "maya_progress_nov_2025.pdf",
            ref: { sourceDocumentId: "doc-maya", pageNumber: 1 },
          },
        ],
      },
    });

    fireEvent.focus(box());
    fireEvent.change(box(), { target: { value: "maya_progress" } });

    expect(screen.getByText("Documents")).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]!.textContent).toContain("Annual progress report");
    expect(options[0]!.textContent).toContain("maya_progress_nov_2025.pdf");
    expect(options[1]!.textContent).toContain("Ask Rowan: maya_progress");
    expect(state.posts).toHaveLength(0);

    // Selecting the document hit opens the source page instead of posting to the assistant.
    fireEvent.click(options[0]!);
    expect(push).toHaveBeenCalledTimes(1);
    expect(String(push.mock.calls[0]![0])).toContain("doc-maya");
    expect(state.posts).toHaveLength(0);
  });
});
