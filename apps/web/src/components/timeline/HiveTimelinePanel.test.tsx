// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MEDICAID_FINDINGS } from "@/dev/gallery/fixtures/findings-gallery";

import { HiveTimelinePanel } from "./HiveTimelinePanel";

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111/timeline",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" }, version: "5.0.0" },
  Document: ({ children }: { children?: unknown }) => <div data-testid="pdf-doc">{children}</div>,
  Page: () => null,
}));

const HIVE_ID = "11111111-1111-4111-8111-111111111111";
const DOC_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

afterEach(() => {
  cleanup();
  routerPush.mockClear();
  vi.unstubAllGlobals();
});

describe("HiveTimelinePanel", () => {
  it("lists timeline events with source refs when the study is canonical", () => {
    const timeline = MEDICAID_FINDINGS.view.blocks.find((block) => block.name === "timeline")?.rows ?? [];
    expect(timeline.length).toBeGreaterThan(0);

    render(
      <HiveTimelinePanel
        hiveId={HIVE_ID}
        staffDisplayName="Priya"
        staffView
        viewerIsClient={false}
        studyAvailability={{ kind: "canonical" }}
        studyLoadError={null}
        timeline={timeline}
        view={MEDICAID_FINDINGS.view}
        sources={MEDICAID_FINDINGS.sources}
        canonicalStudy={MEDICAID_FINDINGS.canonicalStudy}
        documentPages={MEDICAID_FINDINGS.documentPages}
      />,
    );

    expect(screen.getByTestId("timeline-events")).toBeTruthy();
    expect(screen.getByTestId("findings-timeline-list").children.length).toBe(timeline.length);
    expect(screen.getByText("Events in date order")).toBeTruthy();
  });

  it("shows the staff rebuild notice for an older study", () => {
    render(
      <HiveTimelinePanel
        hiveId={HIVE_ID}
        staffDisplayName="Priya"
        staffView
        viewerIsClient={false}
        studyAvailability={{ kind: "older", revisionNumber: 3 }}
        studyLoadError={null}
        timeline={[]}
        view={null}
        sources={null}
        canonicalStudy={null}
      />,
    );

    expect(screen.getByTestId("timeline-older-study")).toBeTruthy();
    expect(screen.getByTestId("canonical-study-notice")).toBeTruthy();
    expect(screen.getByTestId("rebuild-study-link-documents")).toBeTruthy();
  });

  it("shows the calm client line for an older study without timeline rows", () => {
    render(
      <HiveTimelinePanel
        hiveId={HIVE_ID}
        staffDisplayName="Priya"
        staffView={false}
        viewerIsClient
        studyAvailability={{ kind: "older", revisionNumber: 3 }}
        studyLoadError={null}
        timeline={[]}
        view={null}
        sources={null}
        canonicalStudy={null}
      />,
    );

    expect(screen.getByTestId("timeline-older-client").textContent).toContain("Priya's team is still reviewing");
    expect(screen.getByTestId("timeline-empty").textContent).toContain("Study v3");
    expect(screen.queryByTestId("canonical-study-notice")).toBeNull();
  });

  it("lists legacy timeline rows with a saved-report notice and source refs", () => {
    const timeline = MEDICAID_FINDINGS.view.blocks.find((block) => block.name === "timeline")?.rows ?? [];
    render(
      <HiveTimelinePanel
        hiveId={HIVE_ID}
        staffDisplayName="Priya"
        staffView
        viewerIsClient={false}
        studyAvailability={{ kind: "older", revisionNumber: 6 }}
        studyLoadError={null}
        timeline={timeline}
        view={MEDICAID_FINDINGS.view}
        sources={MEDICAID_FINDINGS.sources}
        canonicalStudy={null}
        documentPages={MEDICAID_FINDINGS.documentPages}
      />,
    );

    expect(screen.getByTestId("timeline-legacy-events")).toBeTruthy();
    expect(screen.getByTestId("timeline-legacy-notice").textContent).toContain("Study v6");
    expect(screen.getByTestId("timeline-legacy-notice").textContent).toContain("canonical study");
    expect(screen.getByTestId("findings-timeline-list").children.length).toBe(timeline.length);
    expect(screen.getByTestId("canonical-study-notice")).toBeTruthy();
  });

  it("does not tell a personal owner that a team is reviewing", () => {
    const timeline = MEDICAID_FINDINGS.view.blocks.find((block) => block.name === "timeline")?.rows ?? [];
    render(
      <HiveTimelinePanel
        hiveId={HIVE_ID}
        staffDisplayName={null}
        staffView={false}
        viewerIsClient={false}
        studyAvailability={{ kind: "older", revisionNumber: 6 }}
        studyLoadError={null}
        timeline={timeline}
        view={MEDICAID_FINDINGS.view}
        sources={MEDICAID_FINDINGS.sources}
        canonicalStudy={null}
        documentPages={MEDICAID_FINDINGS.documentPages}
      />,
    );

    const own = screen.getByTestId("timeline-older-own-hive");
    expect(own.textContent?.toLowerCase()).not.toContain("team");
    expect(screen.getByTestId("timeline-legacy-notice")).toBeTruthy();
  });

  it("explains when no study exists yet", () => {
    render(
      <HiveTimelinePanel
        hiveId={HIVE_ID}
        staffDisplayName={null}
        staffView
        viewerIsClient={false}
        studyAvailability={{ kind: "none" }}
        studyLoadError={null}
        timeline={[]}
        view={null}
        sources={null}
        canonicalStudy={null}
      />,
    );

    expect(screen.getByTestId("timeline-no-study").textContent).toContain("Your study builds once documents are read");
    expect(screen.getByRole("link", { name: /Go to Documents/ }).getAttribute("href")).toBe(`/hives/${HIVE_ID}/documents`);
  });

  it("opens the evidence viewer when a legacy projected timeline source ref is clicked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/pages/3/text")) {
          return Response.json({
            pageText: "Goal set on this page.",
            mimeType: "application/pdf",
            pageCount: 5,
            extractionMethod: "pdf_native",
            pageNumber: 3,
          });
        }
        if (url.includes("/viewer-open")) {
          return Response.json({ signedUrl: "https://storage.example/signed", mimeType: "application/pdf" });
        }
        return Response.json({});
      }),
    );
    const timeline = [
      {
        id: "AV-tl-E1",
        date: "2025-03-04",
        statement: "Goal set",
        values: [
          {
            factId: "AV-T0-E0:r0",
            valueAsWritten: "Anchor plan.pdf",
            sourceRef: { sourceDocumentId: DOC_A, pageNumber: 3, quote: "" },
          },
        ],
      },
    ];
    render(
      <HiveTimelinePanel
        hiveId={HIVE_ID}
        staffDisplayName="Priya"
        staffView
        viewerIsClient={false}
        studyAvailability={{ kind: "older", revisionNumber: 6 }}
        studyLoadError={null}
        timeline={timeline}
        view={null}
        sources={null}
        canonicalStudy={null}
        documentPages={{ [DOC_A]: 5 }}
        workspaceDocuments={[{ sourceDocumentId: DOC_A, fileName: "Anchor plan.pdf" }]}
      />,
    );
    const ref = screen.getByTestId("source-ref");
    expect(ref.tagName).toBe("BUTTON");
    fireEvent.click(ref);
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalled();
    });
    expect(String(routerPush.mock.calls[0]?.[0])).toMatch(/evidenceSource=|source=/);
    await waitFor(() => {
      expect(screen.getByTestId("evidence-viewer")).toBeTruthy();
    });
  });

  it("surfaces study load errors", () => {
    render(
      <HiveTimelinePanel
        hiveId={HIVE_ID}
        staffDisplayName={null}
        staffView
        viewerIsClient={false}
        studyAvailability={{
          kind: "load_error",
          error: { message: "We couldn't read this study.", correlationId: "cid", retryable: true },
        }}
        studyLoadError={null}
        timeline={[]}
        view={null}
        sources={null}
        canonicalStudy={null}
      />,
    );

    expect(screen.getByTestId("timeline-study-error").textContent).toContain("We couldn't read this study");
  });
});