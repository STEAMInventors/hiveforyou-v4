import {
  type AnalyzeAvailability,
  isActiveProcessingRunStatus,
  type ProcessingRun,
  STUDY_PREPARATION_STAGES,
  stageIndexForStatus,
} from "@hiveforyou/contracts";

export type PreparationStepState = "done" | "active" | "stopped" | "pending";
export type PreparationStep = { key: string; label: string; description: string; state: PreparationStepState };
export type PreparationOutcome = "idle" | "active" | "succeeded" | "failed" | "needs_clarification";

export function preparationOutcome(run: Pick<ProcessingRun, "status"> | null): PreparationOutcome {
  if (!run) return "idle";
  if (isActiveProcessingRunStatus(run.status)) return "active";
  if (run.status === "SUCCEEDED") return "succeeded";
  if (run.status === "NEEDS_CLARIFICATION") return "needs_clarification";
  return "failed";
}

/** Model stages that recorded a successful output (a failed run stopped at the next one). */
function completedStageCount(run: Pick<ProcessingRun, "stageMetrics">): number {
  return run.stageMetrics.filter((metric) => metric.outcome === "SUCCEEDED").length;
}

/** The four visible stages, derived only from the persisted run. */
export function preparationSteps(run: Pick<ProcessingRun, "status" | "stageMetrics"> | null): PreparationStep[] {
  const outcome = preparationOutcome(run);
  const activeIndex = run ? stageIndexForStatus(run.status) : -1;
  const stoppedIndex = run && outcome === "failed" ? Math.min(completedStageCount(run), STUDY_PREPARATION_STAGES.length - 1) : -1;
  return STUDY_PREPARATION_STAGES.map((stage, index) => {
    let state: PreparationStepState = "pending";
    if (outcome === "succeeded") state = "done";
    else if (outcome === "failed") state = index < stoppedIndex ? "done" : index === stoppedIndex ? "stopped" : "pending";
    else if (outcome === "active") state = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
    return { key: stage.key, label: stage.label, description: stage.description, state };
  });
}

export function preparationCopy(run: ProcessingRun | null): { title: string; sub: string } {
  const outcome = preparationOutcome(run);
  if (!run || outcome === "idle") {
    return { title: "Analyze your documents", sub: "We'll turn your request into a precise study prompt." };
  }
  if (outcome === "succeeded") {
    return { title: "Your study prompt is ready", sub: "Opening the Study tab." };
  }
  if (outcome === "needs_clarification") {
    return {
      title: "We need your request first",
      sub: run.errorMessageSafe ?? "Tell us what you want to understand from these documents, then analyze again.",
    };
  }
  if (outcome === "failed") {
    return {
      title: "Analysis stopped",
      sub: run.errorMessageSafe ?? "Preparation stopped before it finished. You can try again.",
    };
  }
  const index = stageIndexForStatus(run.status);
  const stage = index >= 0 ? STUDY_PREPARATION_STAGES[index] : null;
  return {
    title: stage ? `${stage.label}…` : "Getting ready…",
    sub: stage?.description ?? "Your analysis is queued and will start in a moment.",
  };
}

export function analyzeHint(availability: AnalyzeAvailability): string {
  if (availability.canAnalyze) {
    return availability.requiresCoverageAcknowledgement
      ? "Ready to analyze. Some pages or documents are missing; you'll review them first."
      : "Ready to analyze every read document.";
  }
  switch (availability.reason) {
    case "PREPARATION_ACTIVE":
      return "Analysis is in progress. You can leave this page; it keeps going.";
    case "READ_ACTIVE":
      return "Analyze becomes available when reading finishes.";
    case "NO_ELIGIBLE_DOCUMENTS":
      return "Read your documents first, then analyze.";
  }
}
