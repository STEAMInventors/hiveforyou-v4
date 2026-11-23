// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPLICATION_VIEW_SCHEMA,
  SCENARIO_ANALYSIS_SCHEMA,
  resolveLegacyHomeProjection,
  type ApplicationViewReport,
  type StudyViewRow,
} from "@hiveforyou/contracts";

import { OmniCatalogProvider, useOmniCatalog, type OmniCatalog } from "@/components/ui/omni-catalog";
import { MEDICAID_FINDINGS } from "@/dev/gallery/fixtures/findings-gallery";
import { omniHits } from "@/lib/omni-catalog-search";

import { buildHiveHomeContent } from "./home-model";
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

function CatalogSpy({ onChange }: { onChange: (catalog: OmniCatalog) => void }) {
  const catalog = useOmniCatalog();
  onChange(catalog);
  return null;
}

const LEGACY_REV_6 = "11111111-1111-4111-8111-111111111116";
const DOC_PLAN = "22222222-2222-4222-8222-222222222221";
const DOC_PROGRESS = "22222222-2222-4222-8222-222222222222";
const FOREIGN_DOC = "99999999-9999-4999-8999-999999999999";

function stubEvidenceFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/pages/") && url.includes("/text")) {
        return Response.json({
          pageText: "Verified Maya source page text.",
          mimeType: "application/pdf",
          pageCount: 6,
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
}

function makeMayaLegacyReport(): ApplicationViewReport {
  return {
    id: "33333333-3333-4333-8333-333333333331",
    reportRunId: "55555555-5555-4555-8555-555555555551",
    studyRevisionId: LEGACY_REV_6,
    revisionNumber: 6,
    audience: "CUSTOMER",
    title: "Maya's Annual Summary",
    createdAt: "2026-10-14T12:00:00Z",
    scenarioAnalysis: { schema: SCENARIO_ANALYSIS_SCHEMA, scenarios: [] },
    modelAlias: null,
    view: {
      schema: APPLICATION_VIEW_SCHEMA,
      title: "Maya's Annual Summary",
      audience: "CUSTOMER",
      layout: "PROPOSED",
      components: [
        {
          component: "KeyFindings",
          id: "kf-reading",
          title: "Benchmark progress",
          items: [
            {
              id: "cl-1",
              kind: "FACT",
              numericStatus: null,
              text: "Maya reached 74 points on the November benchmark.",
              refs: [{ sourceDocumentId: DOC_PROGRESS, fileName: "maya_progress_nov_2025.pdf", pageNumber: 2 }],
              quotes: ["74 points on the November benchmark"],
            },
            {
              id: "cl-2",
              kind: "FACT",
              numericStatus: null,
              text: "Foreign hive claim that must never appear on Maya's Home.",
              refs: [{ sourceDocumentId: FOREIGN_DOC, fileName: "other_client.pdf", pageNumber: 1 }],
              quotes: [],
            },
          ],
        },
        {
          component: "IssueList",
          id: "iss-1",
          title: "Open questions",
          issues: [
            {
              severity: "HIGH",
              text: "Verify weekly session minutes match the annual plan.",
              refs: [{ sourceDocumentId: DOC_PLAN, fileName: "maya_annual_plan_2025.pdf", pageNumber: 4 }],
            },
          ],
        },
        {
          component: "Comparison",
          id: "cmp-1",
          title: "Annual Plan vs Progress Report",
          leftLabel: "Annual Plan",
          rightLabel: "Progress Report",
          items: [
            {
              label: "Fluency target",
              left: "80 points",
              right: "74 points",
              refs: [
                { sourceDocumentId: DOC_PLAN, fileName: "maya_annual_plan_2025.pdf", pageNumber: 3 },
                { sourceDocumentId: DOC_PROGRESS, fileName: "maya_progress_nov_2025.pdf", pageNumber: 2 },
              ],
            },
          ],
        },
      ],
    },
  };
}

function makeMayaHistoricalTimeline(): StudyViewRow[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `AV-tl-E${index + 1}`,
    date: `2025-0${index + 1}-15`,
    statement: `Historical milestone ${index + 1}`,
    values: [
      {
        factId: `AV-T0-E${index}:r0`,
        valueAsWritten: "maya_annual_plan_2025.pdf",
        sourceRef: { sourceDocumentId: DOC_PLAN, pageNumber: 1, quote: "" },
      },
    ],
  }));
}

describe("HiveHome legacy and canonical restoration (P0.6)", () => {
  it("restores source-backed findings, review steps, comparisons, 8 historical timeline events, and document search for accepted legacy Maya Hive", async () => {
    stubEvidenceFetch();
    const legacyHome = resolveLegacyHomeProjection({
      studyView: null,
      reports: [makeMayaLegacyReport()],
      acceptedStudyRevisionId: LEGACY_REV_6,
      authorizedSourceDocumentIds: [DOC_PLAN, DOC_PROGRESS],
      authorizedDocumentPages: { [DOC_PLAN]: 6, [DOC_PROGRESS]: 4 },
    });
    const timeline = makeMayaHistoricalTimeline();
    const content = buildHiveHomeContent({
      documentCount: 2,
      checklist: null,
      progress: null,
      openItems: [],
      topics: [],
      sources: null,
      messages: [],
      now: new Date("2026-11-22T12:00:00Z"),
      study: { revisionNumber: 6, acceptedAt: "2026-10-14T12:00:00Z" },
      documentRows: [],
      calculations: [],
      legacyHome,
      legacyDocuments: [
        { sourceDocumentId: DOC_PLAN, fileName: "maya_annual_plan_2025.pdf", eligible: true },
        { sourceDocumentId: DOC_PROGRESS, fileName: "maya_progress_nov_2025.pdf", eligible: true },
      ],
    });

    let registeredCatalog: OmniCatalog | null = null;
    render(
      <OmniCatalogProvider>
        <CatalogSpy onChange={(catalog) => { registeredCatalog = catalog; }} />
        <HiveHome
          hiveId={HIVE_ID}
          viewer="staff"
          clientName="Maya"
          staffName="Priya"
          assistantName="HiveForYou"
          content={content}
          loadError={null}
          studyLoadError={null}
          studyAvailability={{ kind: "older", revisionNumber: 6 }}
          conflicts={[]}
          timeline={timeline}
          timelineReport={{
            reportId: "33333333-3333-4333-8333-333333333339",
            studyRevisionId: LEGACY_REV_6,
            revisionNumber: 6,
            audience: "PRO",
            title: "Earlier v6 Pro report",
            createdAt: "2026-10-12T12:00:00Z",
            fromHistory: true,
          }}
          legacyHome={legacyHome}
          view={null}
          sources={null}
          canonicalStudy={null}
          coverageGaps={[]}
          openItems={[]}
          topics={[]}
          documentPages={{ [DOC_PLAN]: 6, [DOC_PROGRESS]: 4 }}
          workspaceDocuments={[
            { sourceDocumentId: DOC_PLAN, fileName: "maya_annual_plan_2025.pdf" },
            { sourceDocumentId: DOC_PROGRESS, fileName: "maya_progress_nov_2025.pdf" },
          ]}
          initialPeople={{ page: { messages: [] }, peopleById: new Map() }}
          currentUserId="user-1"
          staffView
          viewerIsClient={false}
          hiveFirmId="firm-1"
        />
      </OmniCatalogProvider>,
    );

    // Non-blocking older study notice remains without forcing rebuild.
    expect(screen.getByTestId("home-older-study")).toBeTruthy();
    expect(screen.getByTestId("home-legacy-provenance").textContent).toContain("Study v6");
    expect(screen.getByTestId("home-legacy-provenance").textContent).toContain("Maya's Annual Summary");

    // Restored findings, next steps, comparisons, 8 historical timeline events, and coverage are visible.
    expect(screen.getByText(/74 points on the November benchmark/i)).toBeTruthy();
    expect(screen.queryByText(/Foreign hive claim/i)).toBeNull();
    expect(screen.getByText(/Verify weekly session minutes/i)).toBeTruthy();
    expect(screen.getByTestId("home-supporting-detail")).toBeTruthy();
    expect(screen.getByText("8 events")).toBeTruthy();
    expect(screen.getByTestId("home-legacy-timeline-notice").textContent).toContain("Earlier v6 Pro report");
    expect(screen.getByText("Annual Plan vs Progress Report")).toBeTruthy();

    // Top search indexes Maya's authorized documents by file name, plus legacy statements and open items.
    expect(registeredCatalog).not.toBeNull();
    const docHits = omniHits(registeredCatalog!, "maya_annual_plan");
    expect(docHits.some((hit) => hit.kind === "document" && hit.document.id === DOC_PLAN)).toBe(true);
    const spacedDocHits = omniHits(registeredCatalog!, "progress nov 2025");
    expect(spacedDocHits.some((hit) => hit.kind === "document" && hit.document.id === DOC_PROGRESS)).toBe(true);
    const foreignHits = omniHits(registeredCatalog!, "other_client");
    expect(foreignHits).toHaveLength(0);

    // Clicking a legacy finding opens the EvidenceViewer to its authorized page.
    fireEvent.click(screen.getByRole("button", { name: /74 points on the November benchmark/i }));
    await waitFor(() => {
      expect(screen.getByTestId("evidence-viewer")).toBeTruthy();
    });
  });

  it("expands restored historical timeline by default on legacy Home when no saved report statements exist", () => {
    const timeline = makeMayaHistoricalTimeline();
    const content = buildHiveHomeContent({
      documentCount: 1,
      checklist: null,
      progress: null,
      openItems: [],
      topics: [],
      sources: null,
      messages: [],
      now: new Date("2026-11-22T12:00:00Z"),
      study: { revisionNumber: 6, acceptedAt: "2026-10-14T12:00:00Z" },
      documentRows: [],
      calculations: [],
    });

    render(
      <HiveHome
        hiveId={HIVE_ID}
        viewer="staff"
        clientName="Maya"
        staffName="Priya"
        assistantName="HiveForYou"
        content={content}
        loadError={null}
        studyLoadError={null}
        studyAvailability={{ kind: "older", revisionNumber: 6 }}
        conflicts={[]}
        timeline={timeline}
        legacyHome={null}
        view={null}
        sources={null}
        canonicalStudy={null}
        coverageGaps={[]}
        openItems={[]}
        topics={[]}
        documentPages={{ [DOC_PLAN]: 6 }}
        workspaceDocuments={[{ sourceDocumentId: DOC_PLAN, fileName: "maya_annual_plan_2025.pdf" }]}
        initialPeople={{ page: { messages: [] }, peopleById: new Map() }}
        currentUserId="user-1"
        staffView
        viewerIsClient={false}
        hiveFirmId="firm-1"
      />,
    );

    const summary = screen.getByText("Events in date order").closest("details");
    expect(summary?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Historical milestone 1")).toBeTruthy();
  });

  it("indexes canonical documents by both plain role and fileName on canonical Hive Home", () => {
    let registeredCatalog: OmniCatalog | null = null;
    const canonicalDocRows = MEDICAID_FINDINGS.view.blocks.find((block) => block.name === "documents")?.rows ?? [];
    const firstDocId = canonicalDocRows[0]?.id ?? DOC_PLAN;

    render(
      <OmniCatalogProvider>
        <CatalogSpy onChange={(catalog) => { registeredCatalog = catalog; }} />
        <HiveHome
          hiveId={HIVE_ID}
          viewer="staff"
          clientName="Maya"
          staffName="Priya"
          assistantName="HiveForYou"
          content={{
            hasStudy: true,
            documentsIn: canonicalDocRows.length || 1,
            checklistSize: null,
            toReview: 0,
            stillToCome: [],
            statementCount: 1,
            lastWrote: null,
            study: { revisionNumber: 1, acceptedLabel: "Nov 5" },
            topics: [],
            reviewSteps: [],
            coverage: [],
            calculations: [],
          }}
          loadError={null}
          studyLoadError={null}
          studyAvailability={{ kind: "canonical" }}
          conflicts={[]}
          timeline={[]}
          view={MEDICAID_FINDINGS.view}
          sources={MEDICAID_FINDINGS.sources}
          canonicalStudy={MEDICAID_FINDINGS.canonicalStudy}
          coverageGaps={[]}
          openItems={[]}
          topics={[]}
          documentPages={MEDICAID_FINDINGS.documentPages}
          workspaceDocuments={[{ sourceDocumentId: firstDocId, fileName: "maya_11_05_bank_statement.pdf" }]}
          initialPeople={{ page: { messages: [] }, peopleById: new Map() }}
          currentUserId="user-1"
          staffView
          viewerIsClient={false}
          hiveFirmId="firm-1"
        />
      </OmniCatalogProvider>,
    );

    expect(registeredCatalog).not.toBeNull();
    expect(screen.queryByTestId("home-older-study")).toBeNull();
    expect(
      omniHits(registeredCatalog!, "maya_11_05_bank_statement").some(
        (hit) => hit.kind === "document" && hit.document.id === firstDocId,
      ),
    ).toBe(true);
  });
});