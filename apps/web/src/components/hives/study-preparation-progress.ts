import {
  type AnalyzeAvailability,
  type RebuildAvailability,
  type CoverageGap,
  type CoverageGapReason,
  formatStudyRevisionAcceptanceDetail,
  isActiveProcessingRunStatus,
  isActiveReportRunStatus,
  isLegacyPipelineStatus,
  isProcessingRunStatus,
  LEGACY_STUDY_PREPARATION_STAGES,
  type ProcessingRun,
  type ReportRun,
  type StudyRevisionSummary,
  STUDY_PREPARATION_STAGES,
  stageIndexForStatus,
  studyRevisionAcceptanceSubtext,
} from "@hiveforyou/contracts";

export type PreparationStepState = "done" | "active" | "stopped" | "pending";
export type PreparationStep = { key: string; label: string; description: string; state: PreparationStepState };
export type PreparationOutcome = "idle" | "active" | "awaiting" | "succeeded" | "failed" | "needs_clarification";

export function preparationOutcome(run: Pick<ProcessingRun, "status"> | null): PreparationOutcome {
  if (!run) return "idle";
  if (run.status === "AWAITING_ACKNOWLEDGEMENT") return "awaiting";
  if (isActiveProcessingRunStatus(run.status)) return "active";
  if (run.status === "SUCCEEDED") return "succeeded";
  if (run.status === "NEEDS_CLARIFICATION") return "needs_clarification";
  return "failed";
}

export function usesLegacyProgress(run: Pick<ProcessingRun, "status" | "stageMetrics"> | null): boolean {
  if (!run) return false;
  if (isLegacyPipelineStatus(run.status)) return true;
  return run.stageMetrics.some(
    (metric) => isProcessingRunStatus(metric.stage) && isLegacyPipelineStatus(metric.stage),
  );
}

function visibleStages(run: Pick<ProcessingRun, "status" | "stageMetrics"> | null) {
  if (!usesLegacyProgress(run)) return STUDY_PREPARATION_STAGES;
  return [STUDY_PREPARATION_STAGES[0]!, ...LEGACY_STUDY_PREPARATION_STAGES];
}

function stageProgressIndex(status: ProcessingRun["status"], legacy: boolean): number {
  if (!legacy) return stageIndexForStatus(status);
  if (status === "READING_DOCUMENTS" || status === "AWAITING_ACKNOWLEDGEMENT") return 0;
  if (status === "ACCEPTING_STUDY") {
    return LEGACY_STUDY_PREPARATION_STAGES.findIndex((stage) => stage.key === "VERIFYING_EVIDENCE") + 1;
  }
  const legacyIndex = stageIndexForStatus(status);
  return legacyIndex < 0 ? legacyIndex : legacyIndex + 1;
}

function activeStageIndex(run: Pick<ProcessingRun, "status" | "stageMetrics">): number {
  return stageProgressIndex(run.status, usesLegacyProgress(run));
}

/** The stage a stopped run stopped at, from what it persisted (frozen snapshot, stage metrics). */
function stoppedStageIndex(
  run: Pick<ProcessingRun, "snapshotFrozen" | "stageMetrics">,
  stages: readonly { key: string }[],
  legacy: boolean,
): number {
  let index = run.snapshotFrozen ? 1 : 0;
  for (const metric of run.stageMetrics) {
    if (metric.stage === "WRITING" || !isProcessingRunStatus(metric.stage)) continue;
    const stage = stageProgressIndex(metric.stage, legacy);
    if (stage < 0) continue;
    index = Math.max(index, metric.outcome === "SUCCEEDED" ? stage + 1 : stage);
  }
  return Math.min(index, stages.length - 1);
}

/**
 * "Extracting (n of m documents)". n counts doc_extractions rows bound to this run's frozen snapshot
 * (cached and freshly extracted alike), not stage metrics.
 */
function extractingLabel(
  run: Pick<
    ProcessingRun,
    "extractedDocumentCount" | "authorizedSourceDocumentIds" | "extractingPageCompleted" | "extractingPageTotal"
  > | null,
  state: PreparationStepState,
): string {
  const total = run?.authorizedSourceDocumentIds.length ?? 0;
  if (total === 0) return "Extracting";
  const extracted = Math.min(total, run?.extractedDocumentCount ?? 0);
  const docPart = `${extracted} of ${total} ${total === 1 ? "document" : "documents"}`;
  const pageTotal = run?.extractingPageTotal ?? null;
  const pageDone = run?.extractingPageCompleted ?? null;
  if (
    state === "active" &&
    extracted < total &&
    pageTotal !== null &&
    pageDone !== null &&
    pageTotal > 0 &&
    pageDone < pageTotal
  ) {
    return `Extracting (${docPart}; page ${pageDone} of ${pageTotal})`;
  }
  return `Extracting (${docPart})`;
}

/** The visible stages, derived only from the persisted run. In-flight legacy runs keep their own steps. */
export function preparationSteps(
  run: Pick<
    ProcessingRun,
    | "status"
    | "stageMetrics"
    | "snapshotFrozen"
    | "authorizedSourceDocumentIds"
    | "extractedDocumentCount"
    | "extractingPageCompleted"
    | "extractingPageTotal"
  > | null,
): PreparationStep[] {
  const stages = visibleStages(run);
  const outcome = preparationOutcome(run);
  const activeIndex = run ? activeStageIndex(run) : -1;
  const legacy = usesLegacyProgress(run);
  const stoppedIndex =
    run && (outcome === "failed" || outcome === "needs_clarification") ? stoppedStageIndex(run, stages, legacy) : -1;
  return stages.map((stage, index) => {
    let state: PreparationStepState = "pending";
    if (outcome === "succeeded") state = "done";
    else if (outcome === "awaiting") state = index === 0 ? "done" : "pending";
    else if (stoppedIndex >= 0) state = index < stoppedIndex ? "done" : index === stoppedIndex ? "stopped" : "pending";
    else if (outcome === "active") state = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
    let label: string = stage.label;
    if (!legacy && stage.key === "READING_DOCUMENTS") label = "Reading";
    if (!legacy && stage.key === "EXTRACTING") label = extractingLabel(run, state);
    return { key: stage.key, label, description: stage.description, state };
  });
}

export function preparationCopy(
  run: ProcessingRun | null,
  studyRevision?: StudyRevisionSummary | null,
): { title: string; sub: string } {
  const outcome = preparationOutcome(run);
  if (!run || outcome === "idle") {
    return { title: "Analyze your documents", sub: "We'll study your documents and write two reports from the same evidence." };
  }
  if (outcome === "awaiting") {
    return {
      title: "Some content couldn't be read",
      sub: "Review what's missing. If you continue, the analysis uses only what was read and your reports say what's missing.",
    };
  }
  if (outcome === "succeeded" && run.preparationMode === "REBUILD") {
    const detail = studyRevision ? formatStudyRevisionAcceptanceDetail(studyRevision) : null;
    return {
      title: "Study revision accepted",
      sub: [studyRevisionAcceptanceSubtext(studyRevision?.format, "REBUILD"), detail].filter(Boolean).join(" "),
    };
  }
  if (outcome === "succeeded") {
    const detail = studyRevision ? formatStudyRevisionAcceptanceDetail(studyRevision) : null;
    return {
      title: "Your study is complete",
      sub: [studyRevisionAcceptanceSubtext(studyRevision?.format, run.preparationMode), detail]
        .filter(Boolean)
        .join(" "),
    };
  }
  if (outcome === "needs_clarification") {
    return {
      title: run.errorCode === "COVERAGE_INCOMPLETE" ? "Some content couldn't be read" : "We need your request first",
      sub: run.errorMessageSafe ?? "Tell us what you want to understand from these documents, then analyze again.",
    };
  }
  if (outcome === "failed") {
    return {
      title: "Analysis stopped",
      sub: run.errorMessageSafe ?? "The analysis stopped before it finished. You can try again.",
    };
  }
  const stages = visibleStages(run);
  const index = activeStageIndex(run);
  const stage = index >= 0 ? stages[index] : null;
  return {
    title: stage ? `${stage.label}…` : "Getting ready…",
    sub: stage?.description ?? "Your analysis is queued and will start in a moment.",
  };
}

export type ReportRowState = "pending" | "active" | "retrying" | "ready" | "failed";
export type ReportRow = { audience: ReportRun["audience"]; label: string; state: ReportRowState; detail: string };

const AUDIENCE_LABEL: Record<ReportRun["audience"], string> = { CUSTOMER: "Customer report", PRO: "Pro report" };

/** One row per audience. Each Writer run has its own status; a failed one never affects the other. */
export function reportRows(reportRuns: readonly ReportRun[]): ReportRow[] {
  return (["CUSTOMER", "PRO"] as const).map((audience) => {
    const run = reportRuns.find((candidate) => candidate.audience === audience);
    const label = AUDIENCE_LABEL[audience];
    if (!run) return { audience, label, state: "pending", detail: "Waiting for the study." };
    if (run.status === "SUCCEEDED") return { audience, label, state: "ready", detail: "Ready to read." };
    if (run.status === "FAILED") {
      return { audience, label, state: "failed", detail: run.errorMessageSafe ?? "This report couldn't be written. You can generate it again." };
    }
    if (isActiveReportRunStatus(run.status) && run.attemptCount > 0 && run.status === "QUEUED") {
      return { audience, label, state: "retrying", detail: `Trying again (attempt ${run.attemptCount + 1} of ${run.maxAttempts}).` };
    }
    return { audience, label, state: "active", detail: run.status === "QUEUED" ? "Starting…" : "Writing…" };
  });
}

const GAP_TEXT: Record<CoverageGapReason, string> = {
  NOT_READ: "Not included — not read.",
  READ_FAILED: "Not included — reading didn't finish.",
  UNREADABLE: "Not included — no readable text.",
  READ_ACTIVE: "Not included — still being read.",
  PARTIAL_READ: "Only partly readable.",
  PAGES_NOT_READ: "Some pages weren't read",
  PAGES_WITHOUT_TEXT: "Pages with no text",
  PAGES_NOT_EXTRACTED: "Page could not be fully extracted",
  NO_TEXT: "No readable text on any page.",
};

/** Owner-facing description of one coverage gap (never document text). */
export function coverageGapText(gap: Pick<CoverageGap, "reason" | "pageNumbers">): string {
  const base = GAP_TEXT[gap.reason];
  if (
    gap.reason === "PAGES_NOT_READ" ||
    gap.reason === "PAGES_WITHOUT_TEXT" ||
    gap.reason === "PAGES_NOT_EXTRACTED"
  ) {
    return gap.pageNumbers.length > 0 ? `${base}: ${gap.pageNumbers.join(", ")}.` : `${base}.`;
  }
  return base;
}

/** One-line hint on the Study tab beside Rebuild study. */
export const STUDY_TAB_REBUILD_HINT =
  "Creates a new revision and re-reads only pages not yet extracted. Earlier revisions and reports stay.";

export function rebuildHint(availability: RebuildAvailability): string {
  if (availability.canRebuild) {
    return availability.requiresCoverageAcknowledgement
      ? "Rebuild uses the pages already saved. Some content is missing; you'll review it first. Reports are not regenerated."
      : "Rebuild creates a new study revision from the pages already saved. Earlier revisions and reports stay. Reports are not regenerated.";
  }
  switch (availability.reason) {
    case "DOCUMENTS_NOT_READ":
      return "Read every added document with Analyze before rebuilding the study.";
    case "PREPARATION_ACTIVE":
      return "A study is already running.";
    case "AWAITING_ACKNOWLEDGEMENT":
      return "Finish the review that's waiting before rebuilding.";
    case "NO_ACCEPTED_STUDY":
      return "Analyze first. Rebuild starts a new revision after a study has been accepted.";
    case "NO_DOCUMENTS":
      return "Add a document before rebuilding.";
  }
}

export function analyzeHint(availability: AnalyzeAvailability): string {
  if (availability.canAnalyze) {
    return availability.requiresCoverageAcknowledgement
      ? "Ready to analyze. Some content is missing; you'll review it first."
      : "Ready to analyze. Documents not read yet are read first.";
  }
  switch (availability.reason) {
    case "PREPARATION_ACTIVE":
      return "Analysis is in progress. You can leave this page; it keeps going.";
    case "AWAITING_ACKNOWLEDGEMENT":
      return "Your analysis is waiting for you to review what couldn't be read.";
    case "NO_DOCUMENTS":
      return "Upload a document, then analyze.";
  }
}
