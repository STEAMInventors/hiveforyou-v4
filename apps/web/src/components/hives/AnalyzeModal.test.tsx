// @vitest-environment jsdom
import type {
  CoverageGap,
  ProcessingRun,
  ProcessingRunStatus,
  ReportRun,
  StageMetric,
  StudyPreparationEligibility,
} from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyzeModal } from "./AnalyzeModal";
import { analyzeHint, preparationSteps, reportRows } from "./study-preparation-progress";

const DOC = "33333333-3333-4333-8333-333333333333";
const HIVE_ID = "11111111-1111-4111-8111-111111111111";

function makeRun(status: ProcessingRunStatus, overrides: Partial<ProcessingRun> = {}): ProcessingRun {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    hiveId: HIVE_ID,
    kind: "STUDY_PREPARATION",
    requestId: "55555555-5555-4555-8555-555555555555",
    attemptNumber: 1,
    status,
    preparationMode: "ANALYZE",
    authorizedSourceDocumentIds: [DOC],
    intentRequestIds: ["77777777-7777-4777-8777-777777777777"],
    coverageComplete: true,
    coverageAcknowledged: false,
    coverageDigest: `sha256:${"e".repeat(64)}`,
    coverageStatus: "COMPLETE",
    coverageGaps: [],
    coverageAcknowledgement: "NOT_REQUIRED",
    coverageAcknowledgedAt: null,
    snapshotFrozen: true,
    stageAttempt: 1,
    stageMetrics: [],
    extractedDocumentCount: 0,
    extractingPageCompleted: null,
    extractingPageTotal: null,
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: "66666666-6666-4666-8666-666666666666",
    createdAt: "2026-11-01T10:00:00.000Z",
    startedAt: null,
    updatedAt: "2026-11-01T10:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

function reportRun(audience: "CUSTOMER" | "PRO", status: ReportRun["status"], overrides: Partial<ReportRun> = {}): ReportRun {
  return {
    id: audience === "CUSTOMER" ? "cccccccc-0000-4000-8000-000000000001" : "cccccccc-0000-4000-8000-000000000002",
    hiveId: HIVE_ID,
    studyRevisionId: "dddddddd-0000-4000-8000-000000000001",
    audience,
    trigger: "STUDY_ACCEPTED",
    status,
    attemptCount: 1,
    maxAttempts: 3,
    errorCode: null,
    errorMessageSafe: null,
    retryable: null,
    correlationId: "66666666-6666-4666-8666-666666666666",
    reportId: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

const eligibility: StudyPreparationEligibility = {
  documents: [
    {
      sourceDocumentId: DOC,
      fileName: "Scan.pdf",
      mimeType: "application/pdf",
      sha256: "b".repeat(64),
      readId: "99999999-9999-4999-8999-999999999999",
      readStatus: "PARTIAL",
      readFingerprint: "fp",
      pageSetDigest: `sha256:${"a".repeat(64)}`,
      totalPhysicalPages: 4,
      verifiedPageCount: 3,
      missingPageNumbers: [2],
      emptyPageNumbers: [],
      createdAt: "2026-11-01T10:00:00.000Z",
    },
  ],
  excluded: [
    { sourceDocumentId: "44444444-4444-4444-8444-444444444444", fileName: "Photo.png", reason: "UNREADABLE" },
  ],
  coverageComplete: false,
  activeReadCount: 0,
  coverageDigest: `sha256:${"e".repeat(64)}`,
  gaps: [
    gap("44444444-4444-4444-8444-444444444444", "Photo.png", "UNREADABLE", [], true),
    gap(DOC, "Scan.pdf", "PARTIAL_READ", [], true),
    gap(DOC, "Scan.pdf", "PAGES_NOT_READ", [2], true),
  ],
};

function gap(
  sourceDocumentId: string,
  fileName: string,
  reason: CoverageGap["reason"],
  pageNumbers: number[],
  material: boolean,
  acknowledged = false,
): CoverageGap {
  return { key: `${reason}:${sourceDocumentId}:x`, sourceDocumentId, fileName, reason, pageNumbers, material, acknowledged };
}

function renderModal(props: Partial<ComponentProps<typeof AnalyzeModal>> = {}) {
  const handlers = { onClose: vi.fn(), onConfirm: vi.fn(), onAcknowledge: vi.fn(), onRetry: vi.fn() };
  render(
    <AnalyzeModal
      hiveId={HIVE_ID}
      mode="progress"
      action="analyze"
      run={null}
      studyRevision={null}
      reportRuns={[]}
      eligibility={eligibility}
      pollState="ok"
      starting={false}
      startError={null}
      returnFocusRef={createRef<HTMLElement>()}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
});
afterEach(cleanup);

describe("AnalyzeModal", () => {
  it("shows every stage from reading to checking the evidence, with the current one in progress", () => {
    renderModal({ run: makeRun("DEVELOPING_QUESTIONS") });
    const steps = within(screen.getByTestId("analyze-steps")).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent?.replace(/ \(.*\)$/, ""))).toEqual([
      "Reading your documents",
      "Understanding your request",
      "Identifying the domain",
      "Developing specialist questions",
      "Constructing your study prompt",
      "Investigating your documents",
      "Checking the evidence",
    ]);
    expect(steps.map((step) => step.dataset.state)).toEqual(["done", "done", "done", "active", "pending", "pending", "pending"]);
    expect(screen.getByRole("heading").textContent).toBe("Developing specialist questions…");
    expect(screen.getByRole("button", { name: "Run in background" })).toBeTruthy();
  });

  it("shows accepting the Study as the evidence check", () => {
    renderModal({ run: makeRun("ACCEPTING_STUDY") });
    const steps = within(screen.getByTestId("analyze-steps")).getAllByRole("listitem");
    expect(steps.at(-1)!.dataset.state).toBe("active");
  });

  it("lists every known material gap not acknowledged before, plus visible limitations, before analysis starts", () => {
    const withLimitation: StudyPreparationEligibility = {
      ...eligibility,
      gaps: [
        ...eligibility.gaps,
        gap(DOC, "Scan.pdf", "PAGES_WITHOUT_TEXT", [3], false),
        gap("55555555-5555-4555-8555-555555555555", "Old.pdf", "UNREADABLE", [], true, true),
      ],
    };
    const { onConfirm } = renderModal({ mode: "confirm", eligibility: withLimitation });
    const missing = screen.getByRole("list", { name: "Missing content" });
    expect(missing.textContent).toContain("Photo.png");
    expect(missing.textContent).toContain("no readable text");
    expect(missing.textContent).toContain("Only partly readable.");
    expect(missing.textContent).toContain("Some pages weren't read: 2.");
    expect(missing.textContent).not.toContain("Old.pdf");
    expect(screen.getByRole("list", { name: "Limitations" }).textContent).toContain("Pages with no text: 3.");
    expect(screen.queryByRole("list", { name: "Documents to read" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Analyze what was read" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("does not treat gaps of documents about to be read as known", () => {
    const pending: StudyPreparationEligibility = {
      ...eligibility,
      documents: [],
      excluded: [
        { sourceDocumentId: DOC, fileName: "Plan.pdf", reason: "NOT_READ" },
        { sourceDocumentId: "44444444-4444-4444-8444-444444444444", fileName: "Photo.png", reason: "UNREADABLE" },
      ],
      gaps: [
        gap(DOC, "Plan.pdf", "NOT_READ", [], true),
        gap("44444444-4444-4444-8444-444444444444", "Photo.png", "UNREADABLE", [], true),
      ],
    };
    renderModal({ mode: "confirm", eligibility: pending });
    expect(screen.getByRole("list", { name: "Documents to read" }).textContent).toContain("Plan.pdf");
    const missing = screen.getByRole("list", { name: "Missing content" });
    expect(missing.textContent).toContain("Photo.png");
    expect(missing.textContent).not.toContain("Plan.pdf");
  });

  it("pauses for review when reading found new material gaps, and continues only on acknowledgement", () => {
    const { onAcknowledge } = renderModal({
      run: makeRun("AWAITING_ACKNOWLEDGEMENT", {
        coverageStatus: "MATERIAL_GAPS",
        coverageAcknowledgement: "PENDING",
        coverageGaps: [gap(DOC, "Scan.pdf", "PAGES_NOT_READ", [2], true), gap(DOC, "Scan.pdf", "PAGES_WITHOUT_TEXT", [4], false)],
      }),
    });
    expect(screen.getByRole("heading").textContent).toBe("Some content couldn't be read");
    expect(screen.getByRole("list", { name: "Missing content" }).textContent).toContain("Some pages weren't read: 2.");
    expect(screen.getByRole("list", { name: "Limitations" }).textContent).toContain("Pages with no text: 4.");
    expect(screen.queryByRole("button", { name: "Run in background" })).toBeNull();
    fireEvent.click(screen.getByTestId("analyze-acknowledge"));
    expect(onAcknowledge).toHaveBeenCalledOnce();
  });

  it("shows the persisted limitations of a finished study", () => {
    renderModal({
      run: makeRun("SUCCEEDED", {
        coverageStatus: "NONMATERIAL_GAPS",
        coverageGaps: [gap(DOC, "Scan.pdf", "PAGES_WITHOUT_TEXT", [4], false)],
      }),
    });
    expect(screen.getByRole("list", { name: "Limitations" }).textContent).toContain("Pages with no text: 4.");
  });

  it("shows where a failed run stopped, the safe message and support reference, and offers Try again", () => {
    const metric: StageMetric = { stage: "UNDERSTANDING_REQUEST", outcome: "SUCCEEDED" };
    const { onRetry } = renderModal({
      run: makeRun("FAILED", {
        stageMetrics: [metric, { stage: "IDENTIFYING_DOMAIN", outcome: "FAILED" }],
        errorCode: "MODEL_TIMEOUT",
        errorMessageSafe: "The analysis model took too long to answer. You can try again.",
        retryable: true,
      }),
    });
    const steps = within(screen.getByTestId("analyze-steps")).getAllByRole("listitem");
    expect(steps.map((step) => step.dataset.state)).toEqual([
      "done",
      "done",
      "stopped",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(screen.getByText("The analysis model took too long to answer. You can try again.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("66666666-6666-4666-8666-666666666666");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not offer Try again for a non-retryable failure", () => {
    renderModal({ run: makeRun("FAILED", { retryable: false, errorMessageSafe: "Contact support." }) });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("follows both reports after the Study is accepted, each with its own status", () => {
    renderModal({
      run: makeRun("SUCCEEDED"),
      reportRuns: [
        reportRun("CUSTOMER", "SUCCEEDED", { reportId: "eeeeeeee-0000-4000-8000-000000000001" }),
        reportRun("PRO", "FAILED", { errorMessageSafe: "This report couldn't be written. You can generate it again." }),
      ],
    });
    const rows = within(screen.getByTestId("analyze-reports")).getAllByRole("listitem");
    expect(rows.map((row) => row.dataset.state)).toEqual(["ready", "failed"]);
    expect(rows[1]!.textContent).toContain("You can generate it again.");
    expect(screen.getByTestId("analyze-open-reports").getAttribute("href")).toBe(`/hives/${HIVE_ID}/reports`);
  });

  it("does not offer reports until one is ready", () => {
    renderModal({ run: makeRun("SUCCEEDED"), reportRuns: [reportRun("CUSTOMER", "WRITING"), reportRun("PRO", "QUEUED")] });
    expect(screen.queryByTestId("analyze-open-reports")).toBeNull();
  });

  it("closes on Escape", () => {
    const { onClose } = renderModal({ run: makeRun("UNDERSTANDING_REQUEST") });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("study preparation progress helpers", () => {
  it("marks every stage done on success", () => {
    expect(preparationSteps(makeRun("SUCCEEDED")).every((step) => step.state === "done")).toBe(true);
  });

  it("lists Reading, Extracting (n of m documents), Building study and Accepting for new runs", () => {
    const docs = [DOC, "44444444-4444-4444-8444-444444444444", "88888888-8888-4888-8888-888888888888"];
    const active = preparationSteps(
      makeRun("EXTRACTING", { authorizedSourceDocumentIds: docs, extractedDocumentCount: 1 }),
    );
    expect(active.map((step) => [step.label, step.state])).toEqual([
      ["Reading", "done"],
      ["Extracting (1 of 3 documents)", "active"],
      ["Building study", "pending"],
      ["Accepting", "pending"],
    ]);
    const building = preparationSteps(makeRun("CANONICALIZING", { authorizedSourceDocumentIds: docs, extractedDocumentCount: 3 }));
    expect(building[1]).toMatchObject({ label: "Extracting (3 of 3 documents)", state: "done" });
    expect(preparationSteps(makeRun("EXTRACTING", { extractedDocumentCount: 0 }))[1]!.label).toBe(
      "Extracting (0 of 1 document)",
    );
  });

  it("counts only saved extractions, not failed documents, when extracting stops", () => {
    const docs = [DOC, "44444444-4444-4444-8444-444444444444", "88888888-8888-4888-8888-888888888888"];
    const steps = preparationSteps(
      makeRun("FAILED", {
        authorizedSourceDocumentIds: docs,
        extractedDocumentCount: 2,
        stageMetrics: [{ stage: "EXTRACTING", attempt: 1, outcome: "FAILED" }],
      }),
    );
    expect(steps[1]).toMatchObject({ label: "Extracting (2 of 3 documents)", state: "stopped" });
  });

  it("keeps the earlier steps for an in-flight legacy run", () => {
    const labels = preparationSteps(makeRun("INVESTIGATING")).map((step) => step.label);
    expect(labels[0]).toBe("Reading your documents");
    expect(labels).not.toContain("Building study");
    expect(labels.some((label) => label.startsWith("Extracting"))).toBe(false);
  });

  it("stops at reading when a run fails before its snapshot is frozen", () => {
    const steps = preparationSteps(makeRun("FAILED", { snapshotFrozen: false }));
    expect(steps[0]!.state).toBe("stopped");
  });

  it("shows a Writer retry with its attempt", () => {
    const [customer] = reportRows([reportRun("CUSTOMER", "QUEUED", { attemptCount: 1 })]);
    expect(customer).toMatchObject({ state: "retrying", detail: "Trying again (attempt 2 of 3)." });
  });

  it("explains why Analyze is unavailable", () => {
    expect(analyzeHint({ canAnalyze: false, reason: "NO_DOCUMENTS" })).toMatch(/Upload a document/);
    expect(analyzeHint({ canAnalyze: true, requiresCoverageAcknowledgement: true })).toMatch(/review it first/);
    expect(analyzeHint({ canAnalyze: false, reason: "AWAITING_ACKNOWLEDGEMENT" })).toMatch(/waiting for you to review/);
  });
});
