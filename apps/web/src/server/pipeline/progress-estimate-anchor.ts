import type { ProcessingRun, ReportRun, ReportRunStatus } from "@hiveforyou/contracts";

export function buildProcessingRunProgressFingerprint(input: {
  run: Pick<
    ProcessingRun,
    "status" | "stageAttempt" | "extractedDocumentCount" | "extractingPageCompleted" | "extractingPageTotal"
  >;
  extractedDocumentIds: ReadonlySet<string>;
  savedRangeKeysByDocument: ReadonlyMap<string, ReadonlySet<string>>;
  reportRuns?: readonly ReportRun[];
}): string {
  const savedRanges = [...input.savedRangeKeysByDocument.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([documentId, keys]) => `${documentId}:${[...keys].sort().join(",")}`)
    .join("|");
  const extracted = [...input.extractedDocumentIds].sort().join(",");
  const reportFingerprint =
    input.reportRuns
      ?.map((run) => `${run.id}:${run.status}:${run.attemptCount}`)
      .sort()
      .join("|") ?? "";
  return [
    input.run.status,
    String(input.run.stageAttempt),
    String(input.run.extractedDocumentCount),
    input.run.extractingPageCompleted ?? "",
    input.run.extractingPageTotal ?? "",
    extracted,
    savedRanges,
    reportFingerprint,
  ].join(";");
}

export function buildReportRunProgressFingerprint(input: {
  status: ReportRunStatus;
  attemptCount: number;
}): string {
  return `${input.status}:${input.attemptCount}`;
}
