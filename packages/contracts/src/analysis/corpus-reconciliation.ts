import {
  STUDY_DOCUMENT_DISPOSITIONS,
  type StudyDocumentDisposition,
  type StudyDocumentRole,
  STUDY_EVIDENCE_NEED_STATUSES,
  type StudyEvidenceNeedStatus,
  type InvestigationAnswerStatus,
} from "../study-preparation/execution-manifest-contracts";

/**
 * Corpus reconciliation rules (D-050, V4-004L). `StudyAgentLedger.finish_study` and
 * `verifyStudyInvestigation` both apply these, so a ledger and a hand-built or bypassed output face
 * the same requirements. The rules check completeness and reference integrity only: the model
 * decides which documents and evidence matter; nothing here knows a domain or a document taxonomy.
 * A disposition for every document never proves that every meaningful fact was extracted.
 */

/** Explicit document type for a document whose type cannot be established from its pages. */
export const UNDETERMINED_DOCUMENT_TYPE = "UNDETERMINED";

export const CORPUS_RECONCILIATION_LIMITS = {
  /** Evidence needs per investigation question. */
  evidenceNeeds: 12,
  needChars: 200,
  explanationChars: 600,
  /** Disposition entries in one `finish_study` call. */
  reconciliations: 100,
  reasonChars: 300,
} as const;

export const CORPUS_RECONCILIATION_CODES = [
  "document_description_unusable",
  "document_evidence_missing",
  "documents_unrecorded",
  "documents_unreconciled",
  "document_reconciliation_invalid",
  "finding_other_document",
  "document_not_reviewed",
  "disposition_inconsistent",
  "evidence_needs_missing",
  "evidence_need_unsupported",
  "evidence_need_unexplained",
  "evidence_need_limitation_missing",
  "evidence_need_status_inconsistent",
  "unresolved_document_hidden",
] as const;
export type CorpusReconciliationCode = (typeof CORPUS_RECONCILIATION_CODES)[number];

export type CorpusReconciliationProblem = { readonly code: CorpusReconciliationCode; readonly message: string };

const PLACEHOLDERS: ReadonlySet<string> = new Set([
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "tbd",
  "todo",
  "other",
  "misc",
  "document",
  "unspecified",
  "not applicable",
  "not available",
  "no reason",
]);

/** At least three letters or digits, and not a generic placeholder. */
export function isMeaningfulText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if ((trimmed.match(/[\p{L}\p{N}]/gu) ?? []).length < 3) return false;
  return !PLACEHOLDERS.has(trimmed.toLowerCase().replace(/[.\s]+$/u, ""));
}

export function isUndeterminedDocumentType(value: unknown): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === UNDETERMINED_DOCUMENT_TYPE;
}

export function isDocumentDisposition(value: unknown): value is StudyDocumentDisposition {
  return typeof value === "string" && (STUDY_DOCUMENT_DISPOSITIONS as readonly string[]).includes(value);
}

export function isEvidenceNeedStatus(value: unknown): value is StudyEvidenceNeedStatus {
  return typeof value === "string" && (STUDY_EVIDENCE_NEED_STATUSES as readonly string[]).includes(value);
}

const problem = (code: CorpusReconciliationCode, message: string): CorpusReconciliationProblem => ({ code, message });

export type DocumentClassificationInput = {
  readonly sourceDocumentId: string;
  readonly role: StudyDocumentRole;
  readonly documentType: string;
  readonly roleReasoning: string;
  readonly evidenceCount: number;
  readonly nonEmptyPageCount: number;
  /** Authorized non-empty pages of this document read in full. */
  readonly nonEmptyPagesRead: number;
};

/**
 * A recorded document has a meaningful type and role reasoning backed by same-document evidence, or
 * the explicit `UNDETERMINED` type with role `UNCERTAIN`. An `UNDETERMINED` document may carry no
 * evidence, but only after at least one of its non-empty pages was read (a blank document has none).
 */
export function documentClassificationProblem(input: DocumentClassificationInput): CorpusReconciliationProblem | null {
  const id = input.sourceDocumentId;
  if (!isMeaningfulText(input.roleReasoning)) {
    return problem("document_description_unusable", `roleReasoning for ${id} must explain the role in words.`);
  }
  const undetermined = isUndeterminedDocumentType(input.documentType);
  if (undetermined) {
    if (input.role !== "UNCERTAIN") {
      return problem("document_description_unusable", `documentType ${UNDETERMINED_DOCUMENT_TYPE} for ${id} requires role UNCERTAIN.`);
    }
  } else if (!isMeaningfulText(input.documentType)) {
    return problem(
      "document_description_unusable",
      `documentType for ${id} must name the document type in words, or be ${UNDETERMINED_DOCUMENT_TYPE} with role UNCERTAIN when it cannot be established.`,
    );
  }
  if (input.evidenceCount === 0) {
    if (!undetermined) {
      return problem(
        "document_evidence_missing",
        `${id} needs same-document evidence for its type and role, or documentType ${UNDETERMINED_DOCUMENT_TYPE} with role UNCERTAIN.`,
      );
    }
    if (input.nonEmptyPageCount > 0 && input.nonEmptyPagesRead === 0) {
      return problem("document_not_reviewed", `Read at least one non-empty page of ${id} before classifying it.`);
    }
  }
  return null;
}

export type DocumentDispositionInput = {
  readonly sourceDocumentId: string;
  readonly documentType: string;
  readonly evidenceCount: number;
  readonly disposition: StudyDocumentDisposition;
  /** Owning document of each referenced finding (already known to exist). */
  readonly findings: readonly { readonly id: string; readonly sourceDocumentId: string }[];
  readonly reason: string | null;
  /** Document findings recorded for this document across the whole Study. */
  readonly documentFindingCount: number;
  readonly nonEmptyPagesRead: number;
};

/**
 * `MATERIAL_FINDINGS_RECORDED` cites at least one `DF…` from the same document. `NO_MATERIAL_FINDINGS`
 * needs a reason, a read page and no recorded finding for the document. `UNRESOLVED` needs a reason; any
 * partial findings it cites are same-document. An `UNDETERMINED` or evidence-free document is `UNRESOLVED`.
 */
export function documentDispositionProblem(input: DocumentDispositionInput): CorpusReconciliationProblem | null {
  const id = input.sourceDocumentId;
  const foreign = input.findings.find((finding) => finding.sourceDocumentId !== id);
  if (foreign) {
    return problem("finding_other_document", `${foreign.id} belongs to ${foreign.sourceDocumentId}, not ${id}.`);
  }
  if ((isUndeterminedDocumentType(input.documentType) || input.evidenceCount === 0) && input.disposition !== "UNRESOLVED") {
    return problem("disposition_inconsistent", `${id} has an undetermined classification, so its disposition must be UNRESOLVED.`);
  }
  switch (input.disposition) {
    case "MATERIAL_FINDINGS_RECORDED":
      if (input.findings.length === 0) {
        return problem("disposition_inconsistent", `MATERIAL_FINDINGS_RECORDED for ${id} must cite at least one DF… finding from ${id}.`);
      }
      return null;
    case "NO_MATERIAL_FINDINGS":
      if (!isMeaningfulText(input.reason)) {
        return problem("document_reconciliation_invalid", `NO_MATERIAL_FINDINGS for ${id} needs a reason.`);
      }
      if (input.findings.length > 0 || input.documentFindingCount > 0) {
        return problem(
          "disposition_inconsistent",
          `${id} has recorded document findings; use MATERIAL_FINDINGS_RECORDED and cite them.`,
        );
      }
      if (input.nonEmptyPagesRead === 0) {
        return problem("document_not_reviewed", `Read at least one non-empty page of ${id} before closing it as NO_MATERIAL_FINDINGS.`);
      }
      return null;
    case "UNRESOLVED":
      if (!isMeaningfulText(input.reason)) {
        return problem("document_reconciliation_invalid", `UNRESOLVED for ${id} needs a reason.`);
      }
      return null;
  }
}

export type EvidenceNeedInput = {
  readonly need: string;
  readonly status: StudyEvidenceNeedStatus;
  /** Verified `DF…` and evidence references. */
  readonly referenceCount: number;
  readonly explanation: string | null;
};

export type EvidenceNeedsInput = {
  readonly planQuestionId: string;
  readonly answerStatus: InvestigationAnswerStatus;
  readonly uncertaintyCount: number;
  readonly limitationCount: number;
  readonly needs: readonly EvidenceNeedInput[];
};

/**
 * Every question names its evidence needs. `FOUND` cites verified findings or evidence; `NOT_FOUND`
 * (not found in the authorized pages examined) and `UNCERTAIN` explain themselves and surface as a
 * limitation or uncertainty; `NOT_REQUIRED` explains why. No `NOT_FOUND` entry is ever required.
 */
export function evidenceNeedsProblem(input: EvidenceNeedsInput): CorpusReconciliationProblem | null {
  const q = input.planQuestionId;
  if (input.needs.length === 0) {
    return problem("evidence_needs_missing", `${q} must list the evidence it needs (evidenceNeeds), each FOUND, NOT_FOUND, UNCERTAIN or NOT_REQUIRED.`);
  }
  if (input.needs.length > CORPUS_RECONCILIATION_LIMITS.evidenceNeeds) {
    return problem("evidence_needs_missing", `${q} lists more than ${CORPUS_RECONCILIATION_LIMITS.evidenceNeeds} evidence needs.`);
  }
  for (let i = 0; i < input.needs.length; i += 1) {
    const need = input.needs[i]!;
    if (!isMeaningfulText(need.need)) {
      return problem("evidence_needs_missing", `${q} evidenceNeeds[${i}].need must describe the evidence in words.`);
    }
    if (need.status === "FOUND") {
      if (need.referenceCount === 0) {
        return problem("evidence_need_unsupported", `${q} evidenceNeeds[${i}] is FOUND but cites no recorded DF… finding or E… evidence.`);
      }
      continue;
    }
    if (!isMeaningfulText(need.explanation)) {
      return problem("evidence_need_unexplained", `${q} evidenceNeeds[${i}] is ${need.status} and needs an explanation.`);
    }
    if (need.status === "NOT_FOUND" && input.limitationCount === 0) {
      return problem("evidence_need_limitation_missing", `${q} evidenceNeeds[${i}] is NOT_FOUND, so the answer needs a limitation.`);
    }
    if (need.status === "UNCERTAIN" && input.limitationCount + input.uncertaintyCount === 0) {
      return problem(
        "evidence_need_limitation_missing",
        `${q} evidenceNeeds[${i}] is UNCERTAIN, so the answer needs an uncertainty or a limitation.`,
      );
    }
  }
  const statuses = new Set(input.needs.map((need) => need.status));
  if (input.answerStatus === "ANSWERED" && !statuses.has("FOUND")) {
    return problem("evidence_need_status_inconsistent", `${q} is ANSWERED, so at least one evidence need must be FOUND.`);
  }
  if (input.answerStatus === "MISSING_EVIDENCE" && !statuses.has("NOT_FOUND") && !statuses.has("UNCERTAIN")) {
    return problem(
      "evidence_need_status_inconsistent",
      `${q} is MISSING_EVIDENCE, so at least one evidence need must be NOT_FOUND or UNCERTAIN.`,
    );
  }
  return null;
}

/** Ids not yet covered, in authorized order, for one actionable message. */
export function corpusInventoryProblem(input: {
  readonly authorizedDocumentIds: readonly string[];
  readonly recordedDocumentIds: ReadonlySet<string>;
  /** Omitted to check the recorded inventory only. */
  readonly reconciledDocumentIds?: ReadonlySet<string>;
}): CorpusReconciliationProblem | null {
  const unrecorded = input.authorizedDocumentIds.filter((id) => !input.recordedDocumentIds.has(id));
  if (unrecorded.length > 0) {
    return problem(
      "documents_unrecorded",
      `Record every authorized document with record_document (SUPPORTING, REFERENCE and UNCERTAIN included). Missing: ${unrecorded.join(", ")}.`,
    );
  }
  const reconciled = input.reconciledDocumentIds;
  if (!reconciled) return null;
  const unreconciled = input.authorizedDocumentIds.filter((id) => !reconciled.has(id));
  if (unreconciled.length > 0) {
    return problem(
      "documents_unreconciled",
      `Give every document one disposition in documentReconciliations. Missing: ${unreconciled.join(", ")}.`,
    );
  }
  return null;
}

/** Deterministic coverage note that keeps an `UNRESOLVED` document visible to every reader of the Study. */
export function unresolvedDocumentNote(sourceDocumentId: string, documentType: string, reason: string): string {
  const type = isUndeterminedDocumentType(documentType) ? "type undetermined" : documentType.trim();
  return `Unresolved document ${sourceDocumentId} (${type}): ${reason.trim()}`.slice(0, 600);
}

export function hasUnresolvedDocumentNote(coverageNotes: readonly string[], sourceDocumentId: string): boolean {
  const prefix = `Unresolved document ${sourceDocumentId.toLowerCase()} `;
  return coverageNotes.some((note) => note.toLowerCase().startsWith(prefix.toLowerCase()));
}
