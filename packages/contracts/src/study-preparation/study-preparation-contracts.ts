import { isValidUuid } from "../hives/hive-contracts";
import type { ContractValidation } from "../source-documents/source-document-contracts";
import type { ExecutionManifest } from "./execution-manifest-contracts";
import type { DomainProposal, IntentDecomposition, InvestigationPlan } from "./planning-output-contracts";

/** Mirrored in supabase/migrations/20261102090000_create_study_preparation.sql. */
export const PROCESSING_RUN_STATUSES = [
  "QUEUED",
  "UNDERSTANDING_REQUEST",
  "IDENTIFYING_DOMAIN",
  "PLANNING_INVESTIGATION",
  "BUILDING_PROMPT",
  "SAVING",
  "SUCCEEDED",
  "NEEDS_CLARIFICATION",
  "FAILED",
] as const;
export type ProcessingRunStatus = (typeof PROCESSING_RUN_STATUSES)[number];

export const TERMINAL_PROCESSING_RUN_STATUSES = ["SUCCEEDED", "NEEDS_CLARIFICATION", "FAILED"] as const;

export const MODEL_STAGE_STATUSES = [
  "UNDERSTANDING_REQUEST",
  "IDENTIFYING_DOMAIN",
  "PLANNING_INVESTIGATION",
] as const;
export type ModelStageStatus = (typeof MODEL_STAGE_STATUSES)[number];

/** The four stages shown to the owner. SAVING is the final step of "Building prompt". */
export const STUDY_PREPARATION_STAGES = [
  {
    key: "UNDERSTANDING_REQUEST",
    label: "Understanding your request",
    description: "Separating what you asked into distinct objectives and answerable questions.",
  },
  {
    key: "IDENTIFYING_DOMAIN",
    label: "Identifying the domain",
    description: "Reading sample pages to work out what kind of documents these are.",
  },
  {
    key: "PLANNING_INVESTIGATION",
    label: "Planning the investigation",
    description: "Turning each objective into specific questions the documents must answer.",
  },
  {
    key: "BUILDING_PROMPT",
    label: "Constructing your study prompt",
    description: "Assembling and saving the versioned Study prompt, then checking it was saved.",
  },
] as const;
export type StudyPreparationStageKey = (typeof STUDY_PREPARATION_STAGES)[number]["key"];

export const DOCUMENT_EXCLUSION_REASONS = ["NOT_READ", "READ_FAILED", "UNREADABLE", "READ_ACTIVE"] as const;
export type DocumentExclusionReason = (typeof DOCUMENT_EXCLUSION_REASONS)[number];

export const STALENESS_REASONS = [
  "DOCUMENT_ADDED",
  "DOCUMENT_REMOVED",
  "DOCUMENT_READ_CHANGED",
  "INTENT_ADDED",
] as const;
export type StalenessReasonKind = (typeof STALENESS_REASONS)[number];

export type StageMetric = {
  stage: ModelStageStatus;
  outcome?: "SUCCEEDED" | "FAILED" | null;
  promptId?: string | null;
  promptDigest?: string | null;
  modelAliasRequested?: string | null;
  resolvedModel?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  latencyMs?: number | null;
  plannerLatencyMs?: number | null;
  finishReason?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorCode?: string | null;
  retryable?: boolean | null;
};

export type SnapshotDocument = {
  sourceDocumentId: string;
  fileName: string;
  mimeType: string;
  sha256: string;
  readId: string;
  readStatus: "SUCCEEDED" | "PARTIAL";
  readFingerprint: string;
  pageSetDigest: string;
  totalPhysicalPages: number;
  verifiedPageCount: number;
  missingPageNumbers: number[];
  emptyPageNumbers: number[];
  createdAt: string;
};

export type ExcludedDocument = {
  sourceDocumentId: string;
  fileName: string;
  reason: DocumentExclusionReason;
};

export type SourceSnapshot = {
  documents: SnapshotDocument[];
  excluded: ExcludedDocument[];
  coverageComplete: boolean;
};

export type StudyPreparationEligibility = SourceSnapshot & {
  activeReadCount: number;
  coverageDigest: string;
};

export type ProcessingRun = {
  id: string;
  hiveId: string;
  kind: "STUDY_PREPARATION";
  requestId: string;
  attemptNumber: number;
  status: ProcessingRunStatus;
  authorizedSourceDocumentIds: string[];
  intentRequestIds: string[];
  coverageComplete: boolean;
  coverageAcknowledged: boolean;
  stageMetrics: StageMetric[];
  errorCode: string | null;
  errorMessageSafe: string | null;
  retryable: boolean | null;
  correlationId: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
};

export type SampleCoverage = {
  perPageCharacterLimit: number;
  totalCharacterBudget: number;
  sampledCharacterCount: number;
  pages: { sourceDocumentId: string; pageNumber: number; characters: number; truncated: boolean }[];
  documentsWithoutSample: { sourceDocumentId: string; reason: "NO_CONTENT_PAGE" | "BUDGET_EXHAUSTED" }[];
};

export type StudyPromptPreview = {
  id: string;
  processingRunId: string;
  hiveId: string;
  intentRequestIds: string[];
  intentDecomposition: IntentDecomposition;
  domainProposal: DomainProposal;
  investigationPlan: InvestigationPlan;
  sampleCoverage: SampleCoverage;
  sourceSnapshot: SourceSnapshot;
  executionManifest: ExecutionManifest;
  stageMetadata: StageMetric[];
  promptId: string;
  promptVersion: string;
  promptTemplateDigest: string;
  promptText: string;
  promptDigest: string;
  sourceSnapshotDigest: string;
  intentSnapshotDigest: string;
  coverageComplete: boolean;
  supersededByRunId: string | null;
  createdAt: string;
};

export type PreviewStaleness = {
  stale: boolean;
  reasons: { kind: StalenessReasonKind; sourceDocumentId: string | null }[];
};

export type GetStudyPreparationResponse = {
  processingRun: ProcessingRun | null;
  preview: StudyPromptPreview | null;
  previewSummary: { id: string; processingRunId: string; createdAt: string } | null;
  staleness: PreviewStaleness | null;
  eligibility: StudyPreparationEligibility;
};

export type StartStudyPreparationRequest = {
  clientRequestId: string;
  coverageAcknowledgementDigest?: string;
};

export type StartStudyPreparationResponse = {
  processingRun: ProcessingRun;
  created: boolean;
};

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export function isProcessingRunStatus(value: unknown): value is ProcessingRunStatus {
  return includes(PROCESSING_RUN_STATUSES, value);
}

export function isActiveProcessingRunStatus(value: unknown): boolean {
  return isProcessingRunStatus(value) && !includes(TERMINAL_PROCESSING_RUN_STATUSES, value);
}

/** Index into STUDY_PREPARATION_STAGES for the run's current status (-1 while queued). */
export function stageIndexForStatus(status: ProcessingRunStatus): number {
  if (status === "SAVING") return STUDY_PREPARATION_STAGES.length - 1;
  return STUDY_PREPARATION_STAGES.findIndex((stage) => stage.key === status);
}

export function validateStartStudyPreparationInput(
  body: unknown,
): ContractValidation<{ clientRequestId: string; coverageAcknowledgementDigest: string | null }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Request body must be a JSON object.", diagnosticReason: "invalid_payload_shape" };
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "clientRequestId" && key !== "coverageAcknowledgementDigest") {
      return { ok: false, message: `Unexpected field: ${key}.`, diagnosticReason: "unexpected_field" };
    }
  }
  const clientRequestId =
    typeof record.clientRequestId === "string" ? record.clientRequestId.trim().toLowerCase() : "";
  if (!isValidUuid(clientRequestId)) {
    return {
      ok: false,
      message: "clientRequestId must be a valid UUID.",
      diagnosticReason: "invalid_client_request_id",
    };
  }
  if (record.coverageAcknowledgementDigest === undefined || record.coverageAcknowledgementDigest === null) {
    return { ok: true, value: { clientRequestId, coverageAcknowledgementDigest: null } };
  }
  const digest =
    typeof record.coverageAcknowledgementDigest === "string"
      ? record.coverageAcknowledgementDigest.trim().toLowerCase()
      : "";
  if (!DIGEST.test(digest)) {
    return {
      ok: false,
      message: "coverageAcknowledgementDigest must be the coverage digest you were shown.",
      diagnosticReason: "invalid_coverage_digest",
    };
  }
  return { ok: true, value: { clientRequestId, coverageAcknowledgementDigest: digest } };
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : undefined;
}

function uuidList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map((id) => (typeof id === "string" ? id.toLowerCase() : ""));
  return ids.every((id) => isValidUuid(id)) ? ids : null;
}

export function normalizeProcessingRun(raw: unknown): ProcessingRun | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const ids = [record.id, record.hiveId, record.requestId, record.correlationId];
  if (ids.some((id) => typeof id !== "string" || !isValidUuid(id.toLowerCase()))) return null;
  if (
    record.kind !== "STUDY_PREPARATION" ||
    !isProcessingRunStatus(record.status) ||
    typeof record.attemptNumber !== "number" ||
    !Number.isInteger(record.attemptNumber) ||
    record.attemptNumber < 1 ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.coverageComplete !== "boolean" ||
    typeof record.coverageAcknowledged !== "boolean"
  ) {
    return null;
  }
  const authorizedSourceDocumentIds = uuidList(record.authorizedSourceDocumentIds);
  const intentRequestIds = uuidList(record.intentRequestIds);
  const errorCode = nullableString(record.errorCode);
  const errorMessageSafe = nullableString(record.errorMessageSafe);
  const startedAt = nullableString(record.startedAt);
  const finishedAt = nullableString(record.finishedAt);
  if (
    !authorizedSourceDocumentIds ||
    !intentRequestIds ||
    !Array.isArray(record.stageMetrics) ||
    errorCode === undefined ||
    errorMessageSafe === undefined ||
    startedAt === undefined ||
    finishedAt === undefined
  ) {
    return null;
  }
  return {
    id: (record.id as string).toLowerCase(),
    hiveId: (record.hiveId as string).toLowerCase(),
    kind: "STUDY_PREPARATION",
    requestId: (record.requestId as string).toLowerCase(),
    attemptNumber: record.attemptNumber,
    status: record.status,
    authorizedSourceDocumentIds,
    intentRequestIds,
    coverageComplete: record.coverageComplete,
    coverageAcknowledged: record.coverageAcknowledged,
    stageMetrics: record.stageMetrics as StageMetric[],
    errorCode,
    errorMessageSafe,
    retryable: typeof record.retryable === "boolean" ? record.retryable : null,
    correlationId: (record.correlationId as string).toLowerCase(),
    createdAt: record.createdAt,
    startedAt,
    updatedAt: record.updatedAt,
    finishedAt,
  };
}

function normalizeEligibility(raw: unknown): StudyPreparationEligibility | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (
    !Array.isArray(record.documents) ||
    !Array.isArray(record.excluded) ||
    typeof record.coverageComplete !== "boolean" ||
    typeof record.activeReadCount !== "number" ||
    typeof record.coverageDigest !== "string" ||
    !DIGEST.test(record.coverageDigest)
  ) {
    return null;
  }
  return {
    documents: record.documents as SnapshotDocument[],
    excluded: (record.excluded as ExcludedDocument[]).filter((item) =>
      includes(DOCUMENT_EXCLUSION_REASONS, item?.reason),
    ),
    coverageComplete: record.coverageComplete,
    activeReadCount: record.activeReadCount,
    coverageDigest: record.coverageDigest,
  };
}

export function normalizeGetStudyPreparationResponse(raw: unknown): GetStudyPreparationResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const eligibility = normalizeEligibility(record.eligibility);
  if (!eligibility) return null;
  const processingRun = record.processingRun == null ? null : normalizeProcessingRun(record.processingRun);
  if (record.processingRun != null && !processingRun) return null;
  const preview =
    record.preview && typeof record.preview === "object" ? (record.preview as StudyPromptPreview) : null;
  const staleness =
    record.staleness && typeof record.staleness === "object" ? (record.staleness as PreviewStaleness) : null;
  const previewSummary =
    record.previewSummary && typeof record.previewSummary === "object"
      ? (record.previewSummary as GetStudyPreparationResponse["previewSummary"])
      : null;
  return { processingRun, preview, previewSummary, staleness, eligibility };
}

export type AnalyzeAvailability =
  | { canAnalyze: true; requiresCoverageAcknowledgement: boolean }
  | { canAnalyze: false; reason: "NO_ELIGIBLE_DOCUMENTS" | "READ_ACTIVE" | "PREPARATION_ACTIVE" };

/** Analyze needs one verified read, no active read and no active preparation run. */
export function analyzeAvailability(
  eligibility: StudyPreparationEligibility,
  run: Pick<ProcessingRun, "status"> | null,
): AnalyzeAvailability {
  if (run && isActiveProcessingRunStatus(run.status)) {
    return { canAnalyze: false, reason: "PREPARATION_ACTIVE" };
  }
  if (eligibility.activeReadCount > 0) {
    return { canAnalyze: false, reason: "READ_ACTIVE" };
  }
  if (eligibility.documents.length === 0) {
    return { canAnalyze: false, reason: "NO_ELIGIBLE_DOCUMENTS" };
  }
  return { canAnalyze: true, requiresCoverageAcknowledgement: !eligibility.coverageComplete };
}

export type CoverageGap = {
  sourceDocumentId: string;
  fileName: string;
  kind: "EXCLUDED" | "PARTIAL_READ" | "MISSING_PAGES" | "EMPTY_PAGES";
  reason?: DocumentExclusionReason;
  pageNumbers?: number[];
};

/** Every coverage gap the owner must see before acknowledging partial coverage. */
export function describeCoverageGaps(snapshot: Pick<SourceSnapshot, "documents" | "excluded">): CoverageGap[] {
  const gaps: CoverageGap[] = snapshot.excluded.map((document) => ({
    sourceDocumentId: document.sourceDocumentId,
    fileName: document.fileName,
    kind: "EXCLUDED",
    reason: document.reason,
  }));
  for (const document of snapshot.documents) {
    if (document.readStatus === "PARTIAL") {
      gaps.push({ sourceDocumentId: document.sourceDocumentId, fileName: document.fileName, kind: "PARTIAL_READ" });
    }
    if (document.missingPageNumbers.length > 0) {
      gaps.push({
        sourceDocumentId: document.sourceDocumentId,
        fileName: document.fileName,
        kind: "MISSING_PAGES",
        pageNumbers: document.missingPageNumbers,
      });
    }
    if (document.emptyPageNumbers.length > 0) {
      gaps.push({
        sourceDocumentId: document.sourceDocumentId,
        fileName: document.fileName,
        kind: "EMPTY_PAGES",
        pageNumbers: document.emptyPageNumbers,
      });
    }
  }
  return gaps;
}
