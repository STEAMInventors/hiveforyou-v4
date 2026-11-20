// @vitest-environment jsdom
import type { HiveMessage } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HiveBoardConversation } from "./HiveBoardConversation";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const DOC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          pageText: "Sample text",
          mimeType: "application/pdf",
          pageCount: 3,
          extractionMethod: "pdf_native",
          pageNumber: 1,
          signedUrl: "https://x/s",
        }),
      ),
    ),
  );
});

afterEach(() => cleanup());

describe("HiveBoardConversation evidence chips", () => {
  it("labels chips from the study view and opens the evidence viewer", async () => {
    const view = {
      schema: "hive.study-view/1",
      blocks: [
        {
          name: "documents",
          rows: [{ id: DOC, typeInPlainWords: "Speech-language evaluation", date: null }],
        },
      ],
      components: [],
      sections: [],
      spineSource: null,
    } as never;

    const assistantMessage: HiveMessage = {
      id: "00000000-0000-4000-8000-000000000001",
      authorKind: "assistant",
      authorRole: "assistant",
      authorUserId: null,
      authorDisplayName: "Sam",
      authorRoleLabel: null,
      isMine: false,
      body: "Here is what the file shows.",
      sourceRefs: [
        {
          sourceDocumentId: DOC,
          pageNumber: 1,
          shortLabel: "Speech-language evaluation",
          factId: "F1",
          studyRevisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      ],
      replyToMessageId: null,
      createdAt: new Date().toISOString(),
    };

    render(
      <HiveBoardConversation
        hiveId={HIVE_ID}
        initial={{
          ok: true,
          page: {
            messages: [assistantMessage],
            participantRoleLabels: ["Assistant"],
            participantCount: 1,
            viewerLastReadAt: null,
            nextCursor: null,
          },
        }}
        staffView={false}
        clientName={null}
        viewerIsClient
        studyView={view}
        studySources={{
          documents: {},
          facts: { F1: { sourceDocumentId: DOC, pageNumber: 1, quote: "Sample text" } },
        }}
        canonicalStudy={null}
        coverageGaps={[]}
        documentPages={{ [DOC]: 3 }}
      />,
    );

    const chip = screen.getByTestId("source-chip");
    const ref = within(chip).getByTestId("source-ref");
    expect(ref.getAttribute("title")).toContain("Speech-language evaluation");
    fireEvent.click(ref);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});