import type { ContractValidation } from "../source-documents/source-document-contracts";

/**
 * `hive.study-execution-manifest/1` (D-039): the formal list of inputs a future Canonical Study
 * execution needs, each with an integrity field the executor must check before running.
 * The output contract `hive.study-investigation/1` is referenced here; nothing executes it in
 * V4-004.
 */
export const EXECUTION_MANIFEST_SCHEMA = "hive.study-execution-manifest/1";
export const STUDY_INVESTIGATION_SCHEMA = "hive.study-investigation/1";
export const SOURCE_PAGES_FORMAT = "hive.source-pages/1";
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
  };
  bindings: {
    placeholder: typeof SOURCE_PAGES_PLACEHOLDER;
    input: "sourceDocuments";
    format: typeof SOURCE_PAGES_FORMAT;
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

/** `hive.study-investigation/1` answer shape (future execution output; untrusted until verified). */
export const INVESTIGATION_ANSWER_STATUSES = [
  "ANSWERED",
  "PARTIALLY_ANSWERED",
  "MISSING_EVIDENCE",
  "CONFLICTING",
] as const;
export type InvestigationAnswerStatus = (typeof INVESTIGATION_ANSWER_STATUSES)[number];

type InvestigationEvidence = { sourceDocumentId: string; pageNumber: number; quote: string };

export type StudyInvestigationOutput = {
  schema: typeof STUDY_INVESTIGATION_SCHEMA;
  processingRunId: string;
  answers: {
    planQuestionId: string;
    status: InvestigationAnswerStatus;
    answer: string;
    facts: { statement: string; evidence: InvestigationEvidence[] }[];
    calculations: {
      description: string;
      inputs: { label: string; valueAsWritten: string; evidence: InvestigationEvidence[] }[];
      arithmetic: string;
      result: string;
    }[];
    assessments: {
      judgment: string;
      criterion: string;
      criterionSource: "DOCUMENT" | "GENERAL_KNOWLEDGE";
      criterionEvidence: InvestigationEvidence[];
      factIndexes: number[];
      reasoning: string;
      strength: "STRONG" | "MODERATE" | "TENTATIVE";
      wouldChangeIf: string[];
    }[];
    uncertainties: string[];
    professionalDeterminations: { determination: string; bearingFacts: number[]; decidedBy: string }[];
    evidence: InvestigationEvidence[];
    conflicts: { description: string; evidence: InvestigationEvidence[] }[];
    limitations: string[];
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
