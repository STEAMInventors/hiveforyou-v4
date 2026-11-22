// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MEDICAID_FINDINGS } from "@/dev/gallery/fixtures/findings-gallery";

import { HiveHome } from "./HiveHome";

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/hive-chat-context", () => ({
  useHiveChat: () => null,
  useMinWidth: () => false,
  HIVE_CHAT_PANEL_MIN_WIDTH: 400,
}));

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" }, version: "5.0.0" },
  Document: ({ children }: { children?: unknown }) => <div data-testid="pdf-doc">{children}</div>,
  Page: () => null,
}));

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
  routerPush.mockClear();
  vi.unstubAllGlobals();
});

describe("HiveHome timeline source refs", () => {
  it("opens the evidence viewer when a home timeline source ref is clicked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/pages/") && url.includes("/text")) {
          return Response.json({
            pageText: "Supporting text on the page.",
            mimeType: "application/pdf",
            pageCount: 5,
            extractionMethod: "pdf_native",
            pageNumber: 1,
          });
        }
        if (url.includes("/viewer-open")) {
          return Response.json({ signedUrl: "https://storage.example/signed", mimeType: "application/pdf" });
        }
        return Response.json({});
      }),
    );
    const timeline = MEDICAID_FINDINGS.view.blocks.find((block) => block.name === "timeline")?.rows ?? [];
    expect(timeline.length).toBeGreaterThan(0);

    render(
      <HiveHome
        hiveId={HIVE_ID}
        viewer="staff"
        clientName="Sam"
        staffName="Priya"
        assistantName="HiveForYou"
        content={{
          hasStudy: true,
          documentsIn: 2,
          checklistSize: 2,
          toReview: 0,
          stillToCome: [],
          statementCount: 1,
          lastWrote: null,
          study: { revisionNumber: 8, acceptedLabel: "Nov 2, 2026" },
          topics: [],
          reviewSteps: [],
          coverage: [],
          calculations: [],
        }}
        loadError={null}
        studyLoadError={null}
        studyAvailability={{ kind: "canonical" }}
        conflicts={[]}
        timeline={timeline}
        view={MEDICAID_FINDINGS.view}
        sources={MEDICAID_FINDINGS.sources}
        canonicalStudy={MEDICAID_FINDINGS.canonicalStudy}
        coverageGaps={[]}
        openItems={[]}
        topics={[]}
        documentPages={MEDICAID_FINDINGS.documentPages}
        initialPeople={{ page: { messages: [] }, peopleById: new Map() }}
        currentUserId="user-1"
        staffView
        viewerIsClient={false}
        hiveFirmId="firm-1"
      />,
    );

    const ref = screen.getAllByTestId("source-ref")[0]!;
    expect(ref.tagName).toBe("BUTTON");
    fireEvent.click(ref);
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId("evidence-viewer")).toBeTruthy();
    });
  });
});