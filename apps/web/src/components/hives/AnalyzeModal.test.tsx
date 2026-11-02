// @vitest-environment jsdom
import type { ProcessingRun, ProcessingRunStatus, StageMetric, StudyPreparationEligibility } from "@hiveforyou/contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyzeModal } from "./AnalyzeModal";
import { analyzeHint, preparationSteps } from "./study-preparation-progress";

const DOC = "33333333-3333-4333-8333-333333333333";

function makeRun(status: ProcessingRunStatus, overrides: Partial<ProcessingRun> = {}): ProcessingRun {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    hiveId: "11111111-1111-4111-8111-111111111111",
    kind: "STUDY_PREPARATION",
    requestId: "55555555-5555-4555-8555-555555555555",
    attemptNumber: 1,
    status,
    authorizedSourceDocumentIds: [DOC],
    intentRequestIds: ["77777777-7777-4777-8777-777777777777"],
    coverageComplete: true,
    coverageAcknowledged: false,
    stageMetrics: [],
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
  excluded: [{ sourceDocumentId: "44444444-4444-4444-8444-444444444444", fileName: "Photo.png", reason: "READ_FAILED" }],
  coverageComplete: false,
  activeReadCount: 0,
  coverageDigest: `sha256:${"e".repeat(64)}`,
};

function renderModal(props: Partial<ComponentProps<typeof AnalyzeModal>> = {}) {
  const handlers = { onClose: vi.fn(), onConfirm: vi.fn(), onRetry: vi.fn() };
  render(
    <AnalyzeModal
      mode="progress"
      run={null}
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
  it("shows the four stages with the current one in progress", () => {
    renderModal({ run: makeRun("PLANNING_INVESTIGATION") });
    const steps = within(screen.getByTestId("analyze-steps")).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent?.replace(/ \(.*\)$/, ""))).toEqual([
      "Understanding your request",
      "Identifying the domain",
      "Planning the investigation",
      "Constructing your study prompt",
    ]);
    expect(steps.map((step) => step.dataset.state)).toEqual(["done", "done", "active", "pending"]);
    expect(screen.getByRole("heading").textContent).toBe("Planning the investigation…");
    expect(screen.getByRole("button", { name: "Run in background" })).toBeTruthy();
  });

  it("lists every coverage gap before a partial-coverage analysis starts", () => {
    const { onConfirm } = renderModal({ mode: "confirm" });
    const gaps = screen.getByRole("list", { name: "Missing content" });
    expect(gaps.textContent).toContain("Photo.png");
    expect(gaps.textContent).toContain("reading didn't finish");
    expect(gaps.textContent).toContain("Only partly readable.");
    expect(gaps.textContent).toContain("Pages not saved: 2.");
    fireEvent.click(screen.getByRole("button", { name: "Analyze what was read" }));
    expect(onConfirm).toHaveBeenCalledOnce();
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
    expect(steps.map((step) => step.dataset.state)).toEqual(["done", "stopped", "pending", "pending"]);
    expect(screen.getByText("The analysis model took too long to answer. You can try again.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("66666666-6666-4666-8666-666666666666");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("does not offer Try again for a non-retryable failure", () => {
    renderModal({ run: makeRun("FAILED", { retryable: false, errorMessageSafe: "Contact support." }) });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
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

  it("explains why Analyze is unavailable", () => {
    expect(analyzeHint({ canAnalyze: false, reason: "READ_ACTIVE" })).toMatch(/reading finishes/);
    expect(analyzeHint({ canAnalyze: true, requiresCoverageAcknowledgement: true })).toMatch(/review them first/);
  });
});
