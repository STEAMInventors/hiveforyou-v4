import { isValidUuid } from "../hives/hive-contracts";
import type { ContractValidation } from "../source-documents/source-document-contracts";
import type { ProgressEstimate } from "../pipeline/pipeline-timing";
import type { ExecutionManifest } from "./execution-manifest-contracts";
import type {
  DomainProposal,
  IntentAnalysis,
  IntentIntelligence,
  InvestigationPlan,
} from "./planning-output-contracts";

/** Mirrored in supabase/migrations (latest status CHECK: 20261105162000_doc_extractions_and_v5_stages.sql). */
export const PROCESSING_RUN_STATUSES = [
  "QUEUED",
  "READING_DOCUMENTS",
  /** Reading found material gaps not acknowledged before; the run waits for the owner (B5). */
  "AWAITING_ACKNOWLEDGEMENT",
  "UNDERSTANDING_REQUEST",
  "IDENTIFYING_DOMAIN",
  "DEVELOPING_QUESTIONS",
  "PLANNING_INVESTIGATION",
  "BUILDING_PROMPT",
  "SAVING",
  "INVESTIGATING",
  /** V5 pipeline: one document per workflow invocation (`20261105162000`). */
  "EXTRACTING",
  "CANONICALIZING",
  "VERIFYING_EVIDENCE",
  "ACCEPTING_STUDY",
  "SUCCEEDED",
  "NEEDS_CLARIFICATION",
  "FAILED",
] as const;
export type ProcessingRunStatus = (typeof PROCESSING_RUN_STATUSES)[number];

export const TERMINAL_PROCESSING_RUN_STATUSES = ["SUCCEEDED", "NEEDS_CLARIFICATION", "FAILED"] as const;

export const MODEL_STAGE_STATUSES = [
  "UNDERSTANDING_REQUEST",
  "IDENTIFYING_DOMAIN",
  "DEVELOPING_QUESTIONS",
  "INVESTIGATING",
  "EXTRACTING",
  "CANONICALIZING",
] as const;
export type ModelStageStatus = (typeof MODEL_STAGE_STATUSES)[number];

/** Owner-visible stages for the V5 simplified pipeline (D-052). */
export const STUDY_PREPARATION_STAGES = [
  {
    key: "READING_DOCUMENTS",
    label: "Reading your documents",
    description: "Reading every page of documents not read yet. Pages already verified are reused.",
  },
  {
    key: "EXTRACTING",
    label: "Extracting",
    description: "Extracting several documents at once, using verified facts from each page.",
  },
  {
    key: "CANONICALIZING",
    label: "Building study",
    description: "Building the canonical study from verified extractions.",
  },
  {
    key: "ACCEPTING_STUDY",
    label: "Accepting",
    description: "Accepting the study and queueing your reports.",
  },
] as const;

/** In-flight agentic runs (V4) still use these statuses until they finish. */
export const LEGACY_STUDY_PREPARATION_STAGES = [
  {
    key: "UNDERSTANDING_REQUEST",
    label: "Understanding your request",
    description: "Understanding what you asked for in your own words, without reading the documents.",
  },
  {
    key: "IDENTIFYING_DOMAIN",
    label: "Identifying the domain",
    description: "Reading sample pages to work out what kind of documents these are.",
  },
  {
    key: "DEVELOPING_QUESTIONS",
    label: "Developing specialist questions",
    description: "Working out everything a specialist in this field would ask to fulfil your request.",
  },
  {
    key: "BUILDING_PROMPT",
    label: "Constructing your study prompt",
    description: "Turning each specialist question into investigation instructions and saving the versioned Study prompt.",
  },
  {
    key: "INVESTIGATING",
    label: "Investigating your documents",
    description: "Answering every planned question from your pages, with a source for each claim.",
  },
  {
    key: "VERIFYING_EVIDENCE",
    label: "Checking the evidence",
    description: "Matching every quote to its page and recomputing every calculation before accepting the study.",
  },
] as const;

export type StudyPreparationStageKey =
  | (typeof STUDY_PREPARATION_STAGES)[number]["key"]
  | (typeof LEGACY_STUDY_PREPARATION_STAGES)[number]["key"];

export const DOCUMENT_EXCLUSION_REASONS = ["NOT_READ", "READ_FAILED", "UNREADABLE", "READ_ACTIVE"] as const;
export type DocumentExclusionReason = (typeof DOCUMENT_EXCLUSION_REASONS)[number];

/** Classified in the database (hive.classify_coverage_gaps); the UI only displays them. */
export const COVERAGE_GAP_REASONS = [
  ...DOCUMENT_EXCLUSION_REASONS,
  "PARTIAL_READ",
  "PAGES_NOT_READ",
  "PAGES_WITHOUT_TEXT",
  "PAGES_NOT_EXTRACTED",
  "NO_TEXT",
] as const;
export type CoverageGapReason = (typeof COVERAGE_GAP_REASONS)[number];

export type CoverageGap = {
  /** Bound to the read it describes; acknowledgements are stored per key and reused in the Hive. */
  key: string;
  sourceDocumentId: string;
  fileName: string;
  reason: CoverageGapReason;
  pageNumbers: number[];
  /** Material gaps need an acknowledgement; nonmaterial ones proceed as visible limitations. */
  material: boolean;
  /** Present on eligibility gaps: acknowledged before in this Hive. */
  acknowledged?: boolean;
};

export type CoverageStatus = "COMPLETE" | "NONMATERIAL_GAPS" | "MATERIAL_GAPS";
export type CoverageAcknowledgement = "NOT_REQUIRED" | "PENDING" | "PRIOR" | "OWNER";
const COVERAGE_STATUSES: readonly CoverageStatus[] = ["COMPLETE", "NONMATERIAL_GAPS", "MATERIAL_GAPS"];
const COVERAGE_ACKNOWLEDGEMENTS: readonly CoverageAcknowledgement[] = ["NOT_REQUIRED", "PENDING", "PRIOR", "OWNER"];

export const STALENESS_REASONS = [
  "DOCUMENT_ADDED",
  "DOCUMENT_REMOVED",
  "DOCUMENT_READ_CHANGED",
  "INTENT_ADDED",
] as const;
export type StalenessReasonKind = (typeof STALENESS_REASONS)[number];

export type StageMetric = {
  stage: ModelStageStatus | "WRITING" | "ACCEPTING_STUDY";
  attempt?: number | null;
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
  estimatedDurationMs?: number | null;
  actualDurationMs?: number | null;
  errorCode?: string | null;
  retryable?: boolean | null;
};

export type { ProgressEstimate };

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
  /** Set when the owner uploaded through a missing-document slot on an accepted study revision. */
  canonicalGapId?: string | null;
  canonicalGapStudyRevisionId?: string | null;
  canonicalGapTitle?: string | null;
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
  gaps: CoverageGap[];
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
  /** Null until the snapshot is frozen. */
  coverageDigest: string | null;
  coverageStatus: CoverageStatus | null;
  coverageGaps: CoverageGap[];
  coverageAcknowledgement: CoverageAcknowledgement | null;
  coverageAcknowledgedAt: string | null;
  /** False while documents are still being read. */
  snapshotFrozen: boolean;
  stageAttempt: number;
  stageMetrics: StageMetric[];
  /** Documents with a cached or fresh doc_extraction for this run's frozen snapshot. */
  extractedDocumentCount: number;
  /** While EXTRACTING: pages saved for the first document still missing a merged extraction. */
  extractingPageCompleted: number | null;
  extractingPageTotal: number | null;
  errorCode: string | null;
  errorMessageSafe: string | null;
  retryable: boolean | null;
  correlationId: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
  /**
   * ANALYZE may reuse a compatible accepted Study and queue Writer.
   * REBUILD always starts a new Study investigation and does not queue Writer.
   * Runs saved before this field existed are Analyze runs.
   */
  preparationMode: "ANALYZE" | "REBUILD";
  /** Persisted absolute ETA anchor (updated by the worker when progress changes). */
  estimatedCompletionAt?: string | null;
  estimateFingerprint?: string | null;
  /** Server-computed while the run is active; omitted or null when unknown or already finished. */
  progressEstimate?: ProgressEstimate | null;
  /** Present when the worker holds a stage lease (`claim_processing_run`). */
  leaseExpiresAt?: string | null;
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
  intentDecomposition: IntentAnalysis;
  domainProposal: DomainProposal;
  /** Null on previews prepared before the specialist-question stage existed. */
  intentIntelligence: IntentIntelligence | null;
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

export const REPORT_RUN_STATUSES = ["QUEUED", "WRITING", "VALIDATING", "SAVING", "SUCCEEDED", "FAILED"] as const;
export type ReportRunStatus = (typeof REPORT_RUN_STATUSES)[number];

export type StudyRevisionFormat = "investigation-1" | "canonical-study-1";

export type StudyRevisionSummary = {
  id: string;
  canonicalStudyId: string;
  revisionNumber: number;
  predecessorRevisionId: string | null;
  processingRunId: string;
  format?: StudyRevisionFormat;
  coverageComplete: boolean;
  coverageStatus: CoverageStatus;
  coverageGaps: CoverageGap[];
  coverageAcknowledgement: CoverageAcknowledgement;
  createdAt: string;
  /** Recorded documents on this revision, when the summary includes them. */
  sourceCount?: number;
  /** Atomic `DF…` document findings, when the summary includes them. */
  documentFindingCount?: number;
};

/** One Writer run for one audience over one accepted revision (D-041). */
export type ReportRun = {
  id: string;
  hiveId: string;
  studyRevisionId: string;
  audience: "CUSTOMER" | "PRO";
  trigger: "STUDY_ACCEPTED" | "OWNER_GENERATE";
  status: ReportRunStatus;
  attemptCount: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessageSafe: string | null;
  retryable: boolean | null;
  correlationId: string;
  reportId: string | null;
  createdAt: string;
  finishedAt: string | null;
  estimatedCompletionAt?: string | null;
  estimateFingerprint?: string | null;
  /** Server-computed while the Writer run is active; omitted or null when unknown or finished. */
  progressEstimate?: ProgressEstimate | null;
};

export type GetStudyPreparationResponse = {
  processingRun: ProcessingRun | null;
  preview: StudyPromptPreview | null;
  previewSummary: { id: string; processingRunId: string; createdAt: string } | null;
  staleness: PreviewStaleness | null;
  eligibility: StudyPreparationEligibility;
  /** The Hive's current accepted Canonical Study revision. */
  studyRevision: StudyRevisionSummary | null;
  /** Latest Writer run per audience for that revision. */
  reportRuns: ReportRun[];
};

export type StartStudyPreparationRequest = {
  clientRequestId: string;
  coverageAcknowledgementDigest?: string;
};

export type AcknowledgeStudyCoverageRequest = {
  processingRunId: string;
  coverageDigest: string;
};

export type AcknowledgeStudyCoverageResponse = {
  processingRun: ProcessingRun;
  /** False when the run had already continued (a replay). */
  resumed: boolean;
};

export type StartStudyPreparationResponse = {
  processingRun: ProcessingRun;
  created: boolean;
  /** The accepted Study revision when Analyze reuses a compatible Study (V4-004E). */
  studyRevision?: StudyRevisionSummary | null;
  /** Latest Writer runs per audience when Analyze reuses a compatible Study (V4-004E). */
  reportRuns?: ReportRun[];
  /** True when Analyze reused an accepted compatible Study instead of starting a new Study run. */
  reusedStudy?: boolean;
  /** True when both Customer and Pro reports already exist for the reused compatible Study. */
  reportsReady?: boolean;
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

const LEGACY_PIPELINE_STATUSES = new Set<ProcessingRunStatus>([
  "UNDERSTANDING_REQUEST",
  "IDENTIFYING_DOMAIN",
  "DEVELOPING_QUESTIONS",
  "PLANNING_INVESTIGATION",
  "BUILDING_PROMPT",
  "SAVING",
  "INVESTIGATING",
  "VERIFYING_EVIDENCE",
]);

export function isLegacyPipelineStatus(status: ProcessingRunStatus): boolean {
  return LEGACY_PIPELINE_STATUSES.has(status);
}

/** Index into STUDY_PREPARATION_STAGES for the run's current status (-1 while queued). */
export function stageIndexForStatus(status: ProcessingRunStatus): number {
  if (status === "AWAITING_ACKNOWLEDGEMENT") {
    return STUDY_PREPARATION_STAGES.findIndex((stage) => stage.key === "READING_DOCUMENTS");
  }
  if (isLegacyPipelineStatus(status)) {
    const legacyKey =
      status === "SAVING" ? "BUILDING_PROMPT" : status === "ACCEPTING_STUDY" ? "VERIFYING_EVIDENCE" : status;
    return LEGACY_STUDY_PREPARATION_STAGES.findIndex((stage) => stage.key === legacyKey);
  }
  const key = status === "ACCEPTING_STUDY" ? "ACCEPTING_STUDY" : status;
  return STUDY_PREPARATION_STAGES.findIndex((stage) => stage.key === key);
}

const START_FIELDS = new Set(["clientRequestId", "coverageAcknowledgementDigest"]);
const ACKNOWLEDGE_FIELDS = new Set(["processingRunId", "coverageDigest"]);

export function validateAcknowledgeStudyCoverageInput(
  body: unknown,
): ContractValidation<{ processingRunId: string; coverageDigest: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Request body must be a JSON object.", diagnosticReason: "invalid_payload_shape" };
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ACKNOWLEDGE_FIELDS.has(key)) {
      return { ok: false, message: `Unexpected field: ${key}.`, diagnosticReason: "unexpected_field" };
    }
  }
  const processingRunId = typeof record.processingRunId === "string" ? record.processingRunId.trim().toLowerCase() : "";
  if (!isValidUuid(processingRunId)) {
    return { ok: false, message: "processingRunId must be a valid UUID.", diagnosticReason: "invalid_processing_run_id" };
  }
  const coverageDigest = typeof record.coverageDigest === "string" ? record.coverageDigest.trim().toLowerCase() : "";
  if (!DIGEST.test(coverageDigest)) {
    return {
      ok: false,
      message: "coverageDigest must be the coverage digest you were shown.",
      diagnosticReason: "invalid_coverage_digest",
    };
  }
  return { ok: true, value: { processingRunId, coverageDigest } };
}

export function validateStartStudyPreparationInput(body: unknown): ContractValidation<{
  clientRequestId: string;
  coverageAcknowledgementDigest: string | null;
}> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Request body must be a JSON object.", diagnosticReason: "invalid_payload_shape" };
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!START_FIELDS.has(key)) {
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
    coverageDigest: typeof record.coverageDigest === "string" && DIGEST.test(record.coverageDigest) ? record.coverageDigest : null,
    coverageStatus: includes(COVERAGE_STATUSES, record.coverageStatus) ? record.coverageStatus : null,
    coverageGaps: normalizeCoverageGaps(record.coverageGaps),
    coverageAcknowledgement: includes(COVERAGE_ACKNOWLEDGEMENTS, record.coverageAcknowledgement)
      ? record.coverageAcknowledgement
      : null,
    coverageAcknowledgedAt: typeof record.coverageAcknowledgedAt === "string" ? record.coverageAcknowledgedAt : null,
    snapshotFrozen: record.snapshotFrozen !== false,
    stageAttempt:
      typeof record.stageAttempt === "number" && Number.isInteger(record.stageAttempt) && record.stageAttempt >= 1
        ? record.stageAttempt
        : 1,
    stageMetrics: record.stageMetrics as StageMetric[],
    extractedDocumentCount:
      typeof record.extractedDocumentCount === "number" &&
      Number.isInteger(record.extractedDocumentCount) &&
      record.extractedDocumentCount >= 0
        ? record.extractedDocumentCount
        : 0,
    extractingPageCompleted:
      typeof record.extractingPageCompleted === "number" &&
      Number.isInteger(record.extractingPageCompleted) &&
      record.extractingPageCompleted >= 0
        ? record.extractingPageCompleted
        : null,
    extractingPageTotal:
      typeof record.extractingPageTotal === "number" &&
      Number.isInteger(record.extractingPageTotal) &&
      record.extractingPageTotal >= 0
        ? record.extractingPageTotal
        : null,
    errorCode,
    errorMessageSafe,
    retryable: typeof record.retryable === "boolean" ? record.retryable : null,
    correlationId: (record.correlationId as string).toLowerCase(),
    createdAt: record.createdAt,
    startedAt,
    updatedAt: record.updatedAt,
    finishedAt,
    preparationMode: record.preparationMode === "REBUILD" ? "REBUILD" : "ANALYZE",
    estimatedCompletionAt:
      typeof record.estimatedCompletionAt === "string" ? record.estimatedCompletionAt : null,
    estimateFingerprint: typeof record.estimateFingerprint === "string" ? record.estimateFingerprint : null,
    progressEstimate: normalizeProgressEstimate(record.progressEstimate),
    leaseExpiresAt:
      typeof record.leaseExpiresAt === "string" || record.leaseExpiresAt === null ? record.leaseExpiresAt : undefined,
  };
}

function normalizeProgressEstimate(raw: unknown): ProgressEstimate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.estimatedCompletionAt !== "string" ||
    typeof record.estimatedCompletionLowAt !== "string" ||
    typeof record.estimatedCompletionHighAt !== "string"
  ) {
    return null;
  }
  return {
    estimatedCompletionAt: record.estimatedCompletionAt,
    estimatedCompletionLowAt: record.estimatedCompletionLowAt,
    estimatedCompletionHighAt: record.estimatedCompletionHighAt,
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
    gaps: normalizeCoverageGaps(record.gaps),
  };
}

export function normalizeStartStudyPreparationResponse(raw: unknown): StartStudyPreparationResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const processingRun = normalizeProcessingRun(record.processingRun);
  if (!processingRun) return null;
  const studyRevision = record.studyRevision == null ? undefined : normalizeStudyRevisionSummary(record.studyRevision);
  if (record.studyRevision != null && !studyRevision) return null;
  const reportRuns = Array.isArray(record.reportRuns)
    ? record.reportRuns.map(normalizeReportRun).filter((run): run is ReportRun => run !== null)
    : undefined;
  return {
    processingRun,
    created: record.created === true,
    ...(studyRevision !== undefined ? { studyRevision } : {}),
    ...(reportRuns !== undefined ? { reportRuns } : {}),
    ...(typeof record.reusedStudy === "boolean" ? { reusedStudy: record.reusedStudy } : {}),
    ...(typeof record.reportsReady === "boolean" ? { reportsReady: record.reportsReady } : {}),
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
  const studyRevision = normalizeStudyRevisionSummary(record.studyRevision);
  const reportRuns = Array.isArray(record.reportRuns)
    ? record.reportRuns.map(normalizeReportRun).filter((run): run is ReportRun => run !== null)
    : [];
  return { processingRun, preview, previewSummary, staleness, eligibility, studyRevision, reportRuns };
}

export function normalizeStudyRevisionSummary(raw: unknown): StudyRevisionSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const ids = [record.id, record.canonicalStudyId, record.processingRunId];
  if (ids.some((id) => typeof id !== "string" || !isValidUuid(id.toLowerCase()))) return null;
  if (typeof record.revisionNumber !== "number" || typeof record.createdAt !== "string") return null;
  const sourceCount = nonNegativeInteger(record.sourceCount);
  const documentFindingCount = nonNegativeInteger(record.documentFindingCount);
  const formatRaw = record.format;
  const format: StudyRevisionFormat | undefined =
    formatRaw === "canonical-study-1" || formatRaw === "investigation-1" ? formatRaw : undefined;
  return {
    id: (record.id as string).toLowerCase(),
    canonicalStudyId: (record.canonicalStudyId as string).toLowerCase(),
    revisionNumber: record.revisionNumber,
    predecessorRevisionId: typeof record.predecessorRevisionId === "string" ? record.predecessorRevisionId.toLowerCase() : null,
    processingRunId: (record.processingRunId as string).toLowerCase(),
    ...(format ? { format } : {}),
    coverageComplete: record.coverageComplete === true,
    coverageStatus: includes(COVERAGE_STATUSES, record.coverageStatus)
      ? record.coverageStatus
      : record.coverageComplete === true
        ? "COMPLETE"
        : "MATERIAL_GAPS",
    coverageGaps: normalizeCoverageGaps(record.coverageGaps),
    coverageAcknowledgement: includes(COVERAGE_ACKNOWLEDGEMENTS, record.coverageAcknowledgement)
      ? record.coverageAcknowledgement
      : "NOT_REQUIRED",
    createdAt: record.createdAt,
    ...(sourceCount !== undefined ? { sourceCount } : {}),
    ...(documentFindingCount !== undefined ? { documentFindingCount } : {}),
  };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function normalizeReportRun(raw: unknown): ReportRun | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const ids = [record.id, record.hiveId, record.studyRevisionId, record.correlationId];
  if (ids.some((id) => typeof id !== "string" || !isValidUuid(id.toLowerCase()))) return null;
  if (
    (record.audience !== "CUSTOMER" && record.audience !== "PRO") ||
    (record.trigger !== "STUDY_ACCEPTED" && record.trigger !== "OWNER_GENERATE") ||
    !includes(REPORT_RUN_STATUSES, record.status) ||
    typeof record.attemptCount !== "number" ||
    typeof record.maxAttempts !== "number" ||
    typeof record.createdAt !== "string"
  ) {
    return null;
  }
  const errorCode = nullableString(record.errorCode);
  const errorMessageSafe = nullableString(record.errorMessageSafe);
  const finishedAt = nullableString(record.finishedAt);
  if (errorCode === undefined || errorMessageSafe === undefined || finishedAt === undefined) return null;
  return {
    id: (record.id as string).toLowerCase(),
    hiveId: (record.hiveId as string).toLowerCase(),
    studyRevisionId: (record.studyRevisionId as string).toLowerCase(),
    audience: record.audience,
    trigger: record.trigger,
    status: record.status,
    attemptCount: record.attemptCount,
    maxAttempts: record.maxAttempts,
    errorCode,
    errorMessageSafe,
    retryable: typeof record.retryable === "boolean" ? record.retryable : null,
    correlationId: (record.correlationId as string).toLowerCase(),
    reportId: typeof record.reportId === "string" && isValidUuid(record.reportId.toLowerCase()) ? record.reportId.toLowerCase() : null,
    createdAt: record.createdAt,
    finishedAt,
    estimatedCompletionAt:
      typeof record.estimatedCompletionAt === "string" ? record.estimatedCompletionAt : null,
    estimateFingerprint: typeof record.estimateFingerprint === "string" ? record.estimateFingerprint : null,
    progressEstimate: normalizeProgressEstimate(record.progressEstimate),
  };
}

export function isActiveReportRunStatus(status: ReportRunStatus): boolean {
  return status !== "SUCCEEDED" && status !== "FAILED";
}

export function normalizeCoverageGaps(raw: unknown): CoverageGap[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): CoverageGap[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.key !== "string" ||
      typeof record.sourceDocumentId !== "string" ||
      typeof record.fileName !== "string" ||
      !includes(COVERAGE_GAP_REASONS, record.reason) ||
      typeof record.material !== "boolean"
    ) {
      return [];
    }
    const pageNumbers = Array.isArray(record.pageNumbers)
      ? record.pageNumbers.filter((page): page is number => Number.isInteger(page))
      : [];
    return [
      {
        key: record.key,
        sourceDocumentId: record.sourceDocumentId.toLowerCase(),
        fileName: record.fileName,
        reason: record.reason,
        pageNumbers,
        material: record.material,
        ...(typeof record.acknowledged === "boolean" ? { acknowledged: record.acknowledged } : {}),
      },
    ];
  });
}

export type AnalyzeAvailability =
  | { canAnalyze: true; requiresCoverageAcknowledgement: boolean }
  | { canAnalyze: false; reason: "NO_DOCUMENTS" | "PREPARATION_ACTIVE" | "AWAITING_ACKNOWLEDGEMENT" };

/**
 * Analyze reads whatever is not yet read and reuses a compatible accepted Study. It only needs one
 * uploaded document and no active run. Starting is not consent to gaps: only known material gaps
 * the owner has not acknowledged before need an acknowledgement here. Rebuild Study is separate.
 */
export function analyzeAvailability(
  eligibility: StudyPreparationEligibility,
  run: Pick<ProcessingRun, "status"> | null,
): AnalyzeAvailability {
  if (run?.status === "AWAITING_ACKNOWLEDGEMENT") {
    return { canAnalyze: false, reason: "AWAITING_ACKNOWLEDGEMENT" };
  }
  if (run && isActiveProcessingRunStatus(run.status)) {
    return { canAnalyze: false, reason: "PREPARATION_ACTIVE" };
  }
  if (eligibility.documents.length === 0 && eligibility.excluded.length === 0) {
    return { canAnalyze: false, reason: "NO_DOCUMENTS" };
  }
  return { canAnalyze: true, requiresCoverageAcknowledgement: knownGapsToAcknowledge(eligibility).length > 0 };
}

export type RebuildAvailability =
  | { canRebuild: true; requiresCoverageAcknowledgement: boolean }
  | {
      canRebuild: false;
      reason: "NO_ACCEPTED_STUDY" | "NO_DOCUMENTS" | "DOCUMENTS_NOT_READ" | "PREPARATION_ACTIVE" | "AWAITING_ACKNOWLEDGEMENT";
    };

/**
 * Rebuild Study is explicit. It needs an accepted Study, documents already read, and no active
 * analysis. It does not read files again and does not treat page coverage as consent.
 */
export function rebuildAvailability(
  eligibility: StudyPreparationEligibility,
  run: Pick<ProcessingRun, "status"> | null,
  studyRevision: { id: string } | null,
): RebuildAvailability {
  if (!studyRevision) return { canRebuild: false, reason: "NO_ACCEPTED_STUDY" };
  if (run?.status === "AWAITING_ACKNOWLEDGEMENT") return { canRebuild: false, reason: "AWAITING_ACKNOWLEDGEMENT" };
  if (run && isActiveProcessingRunStatus(run.status)) return { canRebuild: false, reason: "PREPARATION_ACTIVE" };
  if (eligibility.documents.length === 0 && eligibility.excluded.length === 0) {
    return { canRebuild: false, reason: "NO_DOCUMENTS" };
  }
  if (eligibility.documents.length === 0 || eligibility.activeReadCount > 0 || documentsToRead(eligibility).length > 0) {
    return { canRebuild: false, reason: "DOCUMENTS_NOT_READ" };
  }
  return { canRebuild: true, requiresCoverageAcknowledgement: knownGapsToAcknowledge(eligibility).length > 0 };
}

const TO_READ_REASONS: readonly DocumentExclusionReason[] = ["NOT_READ", "READ_FAILED", "READ_ACTIVE"];

/** Documents Analyze will read before it starts (never read, previously failed, or being read). */
export function documentsToRead(eligibility: Pick<StudyPreparationEligibility, "excluded">): ExcludedDocument[] {
  return eligibility.excluded.filter((document) => TO_READ_REASONS.includes(document.reason));
}

function knownGaps(eligibility: Pick<StudyPreparationEligibility, "excluded" | "gaps">): CoverageGap[] {
  const toRead = new Set(documentsToRead(eligibility).map((document) => document.sourceDocumentId));
  return eligibility.gaps.filter((gap) => !toRead.has(gap.sourceDocumentId));
}

/** Material gaps already known (not waiting on a read) that were never acknowledged in this Hive. */
export function knownGapsToAcknowledge(eligibility: Pick<StudyPreparationEligibility, "excluded" | "gaps">): CoverageGap[] {
  return knownGaps(eligibility).filter((gap) => gap.material && gap.acknowledged !== true);
}

/** Known gaps that need no acknowledgement but are shown as limitations. */
export function knownLimitations(eligibility: Pick<StudyPreparationEligibility, "excluded" | "gaps">): CoverageGap[] {
  return knownGaps(eligibility).filter((gap) => !gap.material);
}
