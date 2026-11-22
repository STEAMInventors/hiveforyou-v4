// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MEDICAID_FINDINGS } from "@/dev/gallery/fixtures/findings-gallery";

import { HiveTimelinePanel } from "./HiveTimelinePanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/hives/11111111-1111-4111-8111-111111111111/timeline",
  useSearchParams: () => new URLSearchParams(),
}));

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  cleanup();
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

  it("shows the calm client line for an older study", () => {
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

    expect(screen.getByTestId("timeline-older-study").textContent).toContain("Priya's team is still reviewing");
    expect(screen.queryByTestId("canonical-study-notice")).toBeNull();
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