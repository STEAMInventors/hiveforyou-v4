import type { ContractValidation } from "../source-documents/source-document-contracts";

/**
 * `hive.study-execution-manifest/1` (D-039): the formal list of inputs the Canonical Study
 * execution needs, each with an integrity field the executor checks before running (D-041).
 * Output contract: `hive.study-investigation/1`, verified by `verifyStudyInvestigation`.
 */
export const EXECUTION_MANIFEST_SCHEMA = "hive.study-execution-manifest/1";
export const STUDY_INVESTIGATION_SCHEMA = "hive.study-investigation/1";
/**
 * At execution `{{SOURCE_PAGES}}` becomes an index of the authorized pages (D-042). Page text reaches
 * the model only through the `read_pages` tool. Previews bound to the earlier full-text format
 * (`hive.source-pages/1`) are not executed.
 */
export const SOURCE_PAGE_INDEX_FORMAT = "hive.source-page-index/1";
export const SOURCE_PAGES_PLACEHOLDER = "{{SOURCE_PAGES}}";

export type ManifestSourceDocument = {
  sourceDocumentId: string;
  fileName: string;
  sha256: string;
  readFingerprint: string;
  pageSetDigest: string;
  readStatus: "SUCCEEDED" | "PARTIAL";
  totalPhysicalPages: number;
  authorizedPageNumbers: number[];
};

export type ExecutionManifest = {
  schema: typeof EXECUTION_MANIFEST_SCHEMA;
  prompt: {
    id: string;
    version: string;
    templateDigest: string;
    promptDigest: string;
    componentPrompts: { id: string; digest: string }[];
  };
  outputContract: { id: typeof STUDY_INVESTIGATION_SCHEMA; schemaDigest: string };
  processingRunId: string;
  requiredInputs: {
    intentRequests: { intentRequestIds: string[]; intentSnapshotDigest: string };
    sourceDocuments: { sourceSnapshotDigest: string; documents: ManifestSourceDocument[] };
    investigationPlan: { schema: string; planDigest: string; questionIds: string[] };
    /** Absent on previews prepared before the specialist-question stage existed. */
    intentIntelligence?: { schema: string; intelligenceDigest: string; questionIds: string[] };
    /** Absent on previews prepared before audiences existed (D-041). */
    audienceConfiguration?: { schema: string; source: string; audienceDigest: string };
  };
  bindings: {
    placeholder: typeof SOURCE_PAGES_PLACEHOLDER;
    input: "sourceDocuments";
    format: string;
    rule: string;
  }[];
  coverage: {
    complete: boolean;
    coverageDigest: string;
    excludedDocuments: { sourceDocumentId: string; reason: string }[];
    missingPages: { sourceDocumentId: string; pageNumbers: number[] }[];
    emptyPages: { sourceDocumentId: string; pageNumbers: number[] }[];
  };
  limits: { authorizedPageCount: number; maxOutputTokensAdvisory: number };
};

/** `hive.study-investigation/1` answer shape (model output; untrusted until verified). */
export const INVESTIGATION_ANSWER_STATUSES = [
  "ANSWERED",
  "PARTIALLY_ANSWERED",
  "MISSING_EVIDENCE",
  "CONFLICTING",
] as const;
export type InvestigationAnswerStatus = (typeof INVESTIGATION_ANSWER_STATUSES)[number];

/** Model-defined document relevance (V4-004I). Temporal status is tracked independently. */
export const STUDY_DOCUMENT_ROLES = [
  "PRIMARY",
  "SUPPORTING",
  "REFERENCE",
  "UNCERTAIN",
] as const;
export type StudyDocumentRole = (typeof STUDY_DOCUMENT_ROLES)[number];

/** Document temporal status, tracked independently of document relevance (`role`). */
export const STUDY_DOCUMENT_TEMPORAL_STATUSES = [
  "CURRENT",
  "HISTORICAL",
  "UPCOMING",
  "UNSPECIFIED",
] as const;
export type StudyDocumentTemporalStatus = (typeof STUDY_DOCUMENT_TEMPORAL_STATUSES)[number];

export const STUDY_DOCUMENT_READ_COVERAGES = [
  "FULL_DOCUMENT_READ",
  "PARTIAL_DOCUMENT_READ",
] as const;
export type StudyDocumentReadCoverage = (typeof STUDY_DOCUMENT_READ_COVERAGES)[number];

export const STUDY_FINDING_MODALITIES = [
  "STATED",
  "MEASURED",
  "PLANNED",
  "RECOMMENDED",
  "REQUESTED",
  "DECLINED",
  "REPORTED",
  "OPINION",
  "HISTORICAL",
  "EMPTY_FIELD",
] as const;
export type StudyFindingModality = (typeof STUDY_FINDING_MODALITIES)[number];

/** Per-document reconciliation outcome (V4-004L). `UNRESOLVED` is a visible limitation, never complete extraction. */
export const STUDY_DOCUMENT_DISPOSITIONS = [
  "MATERIAL_FINDINGS_RECORDED",
  "NO_MATERIAL_FINDINGS",
  "UNRESOLVED",
] as const;
export type StudyDocumentDisposition = (typeof STUDY_DOCUMENT_DISPOSITIONS)[number];

/** Per-question evidence need outcome (V4-004L). `NOT_FOUND` means not found in the authorized pages examined. */
export const STUDY_EVIDENCE_NEED_STATUSES = ["FOUND", "NOT_FOUND", "UNCERTAIN", "NOT_REQUIRED"] as const;
export type StudyEvidenceNeedStatus = (typeof STUDY_EVIDENCE_NEED_STATUSES)[number];

export type InvestigationEvidence = { sourceDocumentId: string; pageNumber: number; quote: string };

export type StudyDocumentReconciliation = {
  disposition: StudyDocumentDisposition;
  /** `DF…` findings from this same document. */
  findingIds: string[];
  reason: string | null;
};

export type StudyEvidenceNeed = {
  need: string;
  status: StudyEvidenceNeedStatus;
  findingIds: string[];
  evidence: InvestigationEvidence[];
  explanation: string | null;
};

export type StudyDocumentRecord = {
  sourceDocumentId: string;
  role: StudyDocumentRole;
  roleReasoning: string;
  documentType: string;
  titleAsPrinted?: string | null;
  issuer?: string | null;
  subjects?: string[];
  temporalStatus: StudyDocumentTemporalStatus;
  effectivePeriod?: {
    startDate: string | null;
    endDate: string | null;
    asWritten: string | null;
  } | null;
  declaredReadCoverage: StudyDocumentReadCoverage;
  /** Physical page numbers of this document actually read in full via `read_pages`. */
  pagesRead: number[];
  /** Physical page numbers of this document cited in verified evidence. */
  pagesCited: number[];
  /** Empty only for an `UNDETERMINED` document (V4-004L). */
  evidence: InvestigationEvidence[];
  /** Additive (V4-004L); absent on earlier accepted Study revisions. */
  reconciliation?: StudyDocumentReconciliation;
};

export type StudyDocumentFinding = {
  /** Stable case-wide document finding identifier (`DF1`, `DF2`, …). */
  id: string;
  sourceDocumentId: string;
  category: string;
  subject: string;
  attribute: string;
  valueAsWritten: string;
  statement: string;
  modality: StudyFindingModality;
  itemKey: string | null;
  dates: string[];
  unit?: string | null;
  per?: string | null;
  section?: string | null;
  attributedTo?: string | null;
  relatedFindingIds?: string[];
  evidence: InvestigationEvidence[];
};

export type StudyInvestigationOutput = {
  schema: typeof STUDY_INVESTIGATION_SCHEMA;
  processingRunId: string;
  /** Optional additive document inventory (V4-004I); absent on earlier accepted Study revisions. */
  documents?: StudyDocumentRecord[];
  /** Optional additive atomic document findings (`DF1…`, V4-004I); absent on earlier accepted Study revisions. */
  documentFindings?: StudyDocumentFinding[];
  answers: {
    planQuestionId: string;
    status: InvestigationAnswerStatus;
    answer: string;
    /** Optional references to reusable `DF…` document findings supporting this answer (V4-004I). */
    findingIds?: string[];
    facts: { statement: string; evidence: InvestigationEvidence[] }[];
    calculations: {
      description: string;
      inputs: {
        label: string;
        valueAsWritten: string;
        evidence: InvestigationEvidence[];
        findingIds?: string[];
      }[];
      arithmetic: string;
      result: string;
      /** Restricted formula tree over `inputs` (D-041); recomputed by `verifyStudyInvestigation`. */
      formula?: unknown;
    }[];
    assessments: {
      judgment: string;
      criterion: string;
      criterionSource: "DOCUMENT" | "GENERAL_KNOWLEDGE";
      criterionEvidence: InvestigationEvidence[];
      factIndexes: number[];
      findingIds?: string[];
      reasoning: string;
      strength: "STRONG" | "MODERATE" | "TENTATIVE";
      wouldChangeIf: string[];
    }[];
    uncertainties: string[];
    professionalDeterminations: {
      determination: string;
      bearingFacts: number[];
      bearingFindingIds?: string[];
      decidedBy: string;
    }[];
    evidence: InvestigationEvidence[];
    conflicts: {
      description: string;
      evidence: InvestigationEvidence[];
      findingIds?: string[];
    }[];
    limitations: string[];
    /** Additive (V4-004L); absent on earlier accepted Study revisions. */
    evidenceNeeds?: StudyEvidenceNeed[];
  }[];
  coverageNotes: string[];
  instructionsIgnored: { sourceDocumentId: string; pageNumber: number; description: string }[];
};

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Structural check used on readback; the builder is the only producer. */
export function validateExecutionManifest(raw: unknown): ContractValidation<ExecutionManifest> {
  const invalid = (diagnosticReason: string): ContractValidation<ExecutionManifest> => ({
    ok: false,
    message: "The execution manifest is incomplete.",
    diagnosticReason,
  });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("manifest_shape");
  const manifest = raw as ExecutionManifest;
  if (manifest.schema !== EXECUTION_MANIFEST_SCHEMA) return invalid("manifest_schema");
  if (
    !manifest.prompt ||
    !DIGEST.test(manifest.prompt.templateDigest ?? "") ||
    !DIGEST.test(manifest.prompt.promptDigest ?? "")
  ) {
    return invalid("manifest_prompt");
  }
  if (manifest.outputContract?.id !== STUDY_INVESTIGATION_SCHEMA || !DIGEST.test(manifest.outputContract.schemaDigest ?? "")) {
    return invalid("manifest_output_contract");
  }
  const inputs = manifest.requiredInputs;
  if (
    !inputs ||
    !DIGEST.test(inputs.intentRequests?.intentSnapshotDigest ?? "") ||
    !DIGEST.test(inputs.sourceDocuments?.sourceSnapshotDigest ?? "") ||
    !DIGEST.test(inputs.investigationPlan?.planDigest ?? "") ||
    !Array.isArray(inputs.sourceDocuments.documents) ||
    inputs.sourceDocuments.documents.length === 0 ||
    inputs.sourceDocuments.documents.some(
      (document) => !DIGEST.test(document.pageSetDigest ?? "") || !Array.isArray(document.authorizedPageNumbers),
    )
  ) {
    return invalid("manifest_required_inputs");
  }
  if (!Array.isArray(manifest.bindings) || !manifest.bindings.some((b) => b.placeholder === SOURCE_PAGES_PLACEHOLDER)) {
    return invalid("manifest_bindings");
  }
  if (!manifest.coverage || typeof manifest.coverage.complete !== "boolean" || !DIGEST.test(manifest.coverage.coverageDigest ?? "")) {
    return invalid("manifest_coverage");
  }
  return { ok: true, value: manifest };
}
