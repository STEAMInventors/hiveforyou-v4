/**
 * P0.5-B — Deterministic assistant evidence adapter for accepted legacy (`investigation-1`) studies.
 *
 * Adapts accepted, verified `FACT` claims from a persisted `hive.study-investigation/1` +
 * `hive.study-verification/1` pair into `AssistantBriefingFact` entries and a verified server-side
 * citation map (`factsById`). Preserves original claim IDs (`DF…`, `P#.F#`), statements,
 * `sourceDocumentId`s, page numbers, and verbatim quotations while rejecting any unverified,
 * unresolved, unauthorized, cross-document (`DF…`), or out-of-bounds reference.
 *
 * Quotations remain in the server-side `factsById` map and are NEVER copied into `briefingFacts`.
 */

import {
  DOCUMENT_FINDING_ID_RE,
  firstUngroundedFindingNumber,
  normalizeQuoteText,
  STUDY_VERIFICATION_SCHEMA,
} from "../analysis/study-verification";
import {
  STUDY_FINDING_MODALITIES,
  STUDY_INVESTIGATION_SCHEMA,
  type StudyFindingModality,
} from "../study-preparation/execution-manifest-contracts";
import type { AssistantBriefingFact } from "./assistant-briefing";
import type { AssistantSourceRef } from "./assistant-reply";
import { isValidUuid } from "./hive-contracts";

const MAX_STATEMENT_CHARS = 1200;
const MAX_QUOTE_CHARS = 600;
const MAX_VALUE_CHARS = 600;
const MAX_LABEL_CHARS = 200;

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const FILE_EXT_PATTERN = /\b[\w-]+\.(pdf|png|jpe?g|tif|tiff|docx?|xlsx?)\b/gi;

export type LegacyAuthorizedSnapshotDocument = {
  readonly sourceDocumentId: string;
  readonly totalPhysicalPages: number;
  readonly missingPageNumbers?: readonly number[];
  readonly emptyPageNumbers?: readonly number[];
};

export type LegacyAssistantEvidenceItem = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly quote: string;
  readonly sourceLabel: string;
};

export type LegacyAssistantVerifiedFact = {
  readonly id: string;
  readonly statement: string;
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly sourceLabel: string;
  readonly quote: string;
  readonly evidence: readonly LegacyAssistantEvidenceItem[];
};

export type LegacyAssistantEvidence = {
  readonly briefingFacts: readonly AssistantBriefingFact[];
  readonly factsById: ReadonlyMap<string, LegacyAssistantVerifiedFact>;
  readonly documentLabels: Readonly<Record<string, string>>;
  readonly rejectedFactCount: number;
};

export const EMPTY_LEGACY_ASSISTANT_EVIDENCE: LegacyAssistantEvidence = {
  briefingFacts: [],
  factsById: new Map(),
  documentLabels: {},
  rejectedFactCount: 0,
};

export type BuildLegacyAssistantEvidenceInput = {
  /** Expected `processingRunId` of the accepted Study revision. */
  readonly expectedProcessingRunId: string;
  /** Persisted `hive.study_revisions.investigation` JSONB. */
  readonly investigation: unknown;
  /** Persisted `hive.study_revisions.verification` JSONB. */
  readonly verification: unknown;
  /** Frozen authorized snapshot documents for this accepted revision. */
  readonly authorizedDocuments: readonly LegacyAuthorizedSnapshotDocument[];
  /**
   * Optional authorized page text keyed `${sourceDocumentId.toLowerCase()}:${pageNumber}`.
   * When provided, every quote is additionally re-verified verbatim against the page text.
   */
  readonly authorizedPageText?: ReadonlyMap<string, string> | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return isValidUuid(trimmed) ? trimmed : null;
}

function nonEmptyText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || value.length > maxChars) return null;
  return trimmed;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function sanitizePlainLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_LABEL_CHARS) return null;
  if (trimmed.toUpperCase() === "UNDETERMINED") return null;
  const cleaned = trimmed
    .replace(EMAIL_PATTERN, "")
    .replace(FILE_EXT_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned !== "" ? cleaned : null;
}

function intSet(raw: unknown): Set<number> {
  const out = new Set<number>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (isPositiveInt(item)) out.add(item);
  }
  return out;
}

type AuthorizedDocBounds = {
  readonly totalPhysicalPages: number;
  readonly missingPages: ReadonlySet<number>;
  readonly emptyPages: ReadonlySet<number>;
  readonly snapshotIndex: number;
};

type DocumentCoverageBounds = {
  readonly authorizedPageNumbers: ReadonlySet<number>;
  readonly pagesRead: ReadonlySet<number>;
};

function buildAuthorizedDocMap(
  docs: readonly LegacyAuthorizedSnapshotDocument[],
): Map<string, AuthorizedDocBounds> {
  const map = new Map<string, AuthorizedDocBounds>();
  let snapshotIndex = 0;
  for (const doc of docs) {
    const id = normalizeUuid(doc?.sourceDocumentId);
    if (!id || map.has(id)) continue;
    if (!isPositiveInt(doc.totalPhysicalPages)) continue;
    map.set(id, {
      totalPhysicalPages: doc.totalPhysicalPages,
      missingPages: intSet(doc.missingPageNumbers),
      emptyPages: intSet(doc.emptyPageNumbers),
      snapshotIndex,
    });
    snapshotIndex += 1;
  }
  return map;
}

function parseVerification(
  raw: unknown,
  expectedRunId: string,
): {
  readonly questionIds: ReadonlySet<string>;
  readonly claimIds: ReadonlySet<string>;
  readonly coverageByDoc: ReadonlyMap<string, DocumentCoverageBounds>;
} | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  if (rec.schema !== STUDY_VERIFICATION_SCHEMA) return null;
  const runId = normalizeUuid(rec.processingRunId);
  if (!runId || runId !== expectedRunId) return null;

  if (!Array.isArray(rec.questionIds) || !Array.isArray(rec.claimIds)) return null;
  const questionIds = new Set<string>();
  for (const qId of rec.questionIds) {
    if (typeof qId !== "string" || qId.trim() === "") return null;
    questionIds.add(qId);
  }
  const claimIds = new Set<string>();
  for (const cId of rec.claimIds) {
    if (typeof cId !== "string" || cId.trim() === "") return null;
    claimIds.add(cId);
  }
  if (questionIds.size === 0 || claimIds.size === 0) return null;

  const counts = asRecord(rec.counts);
  if (!counts) return null;
  if (
    !isNonNegativeInt(counts.answers) ||
    !isNonNegativeInt(counts.facts) ||
    !isNonNegativeInt(counts.quotes) ||
    !isNonNegativeInt(counts.citedPages)
  ) {
    return null;
  }
  if (counts.documentFindings !== undefined && !isNonNegativeInt(counts.documentFindings)) {
    return null;
  }
  if (counts.quotes <= 0 || counts.citedPages <= 0) return null;

  const coverageByDoc = new Map<string, DocumentCoverageBounds>();
  if (rec.documentCoverage !== undefined) {
    if (!Array.isArray(rec.documentCoverage)) return null;
    for (const item of rec.documentCoverage) {
      const cov = asRecord(item);
      if (!cov) return null;
      const docId = normalizeUuid(cov.sourceDocumentId);
      if (!docId) return null;
      if (!Array.isArray(cov.authorizedPageNumbers) || !Array.isArray(cov.pagesRead)) return null;
      coverageByDoc.set(docId, {
        authorizedPageNumbers: intSet(cov.authorizedPageNumbers),
        pagesRead: intSet(cov.pagesRead),
      });
    }
  }

  return { questionIds, claimIds, coverageByDoc };
}

function buildDocumentLabels(
  investigation: Record<string, unknown>,
  authorizedDocs: ReadonlyMap<string, AuthorizedDocBounds>,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [docId, bounds] of authorizedDocs.entries()) {
    labels[docId] = `Document ${bounds.snapshotIndex + 1}`;
  }
  if (Array.isArray(investigation.documents)) {
    for (const rawDoc of investigation.documents) {
      const doc = asRecord(rawDoc);
      if (!doc) continue;
      const docId = normalizeUuid(doc.sourceDocumentId);
      if (!docId || !authorizedDocs.has(docId)) continue;
      const plain = sanitizePlainLabel(doc.documentType) ?? sanitizePlainLabel(doc.titleAsPrinted);
      if (plain) labels[docId] = plain;
    }
  }
  return labels;
}

/**
 * Deterministically adapts accepted, verified `FACT` claims from a legacy `investigation-1`
 * study into `AssistantBriefingFact` entries and a verified citation lookup map.
 * Fails closed to `EMPTY_LEGACY_ASSISTANT_EVIDENCE` whenever the revision envelope,
 * persisted verification, or authorized snapshot cannot be validated.
 */
export function buildLegacyAssistantEvidence(
  input: BuildLegacyAssistantEvidenceInput,
): LegacyAssistantEvidence {
  const expectedRunId = normalizeUuid(input.expectedProcessingRunId);
  if (!expectedRunId) return EMPTY_LEGACY_ASSISTANT_EVIDENCE;

  const authorizedDocs = buildAuthorizedDocMap(input.authorizedDocuments);
  if (authorizedDocs.size === 0) return EMPTY_LEGACY_ASSISTANT_EVIDENCE;

  const inv = asRecord(input.investigation);
  if (!inv || inv.schema !== STUDY_INVESTIGATION_SCHEMA) return EMPTY_LEGACY_ASSISTANT_EVIDENCE;
  const invRunId = normalizeUuid(inv.processingRunId);
  if (!invRunId || invRunId !== expectedRunId) return EMPTY_LEGACY_ASSISTANT_EVIDENCE;
  if (!Array.isArray(inv.answers) || inv.answers.length === 0) return EMPTY_LEGACY_ASSISTANT_EVIDENCE;

  const verified = parseVerification(input.verification, expectedRunId);
  if (!verified) return EMPTY_LEGACY_ASSISTANT_EVIDENCE;

  const documentLabels = buildDocumentLabels(inv, authorizedDocs);
  const normalizedPages = new Map<string, string>();

  const validateEvidenceList = (
    rawEvidence: unknown,
    requiredDocumentId?: string,
  ): LegacyAssistantEvidenceItem[] | null => {
    if (!Array.isArray(rawEvidence) || rawEvidence.length === 0) return null;
    const out: LegacyAssistantEvidenceItem[] = [];
    const seen = new Set<string>();
    for (const rawItem of rawEvidence) {
      const item = asRecord(rawItem);
      if (!item) return null;
      const docId = normalizeUuid(item.sourceDocumentId);
      if (!docId) return null;
      if (requiredDocumentId && docId !== requiredDocumentId) return null;
      const docBounds = authorizedDocs.get(docId);
      if (!docBounds) return null;

      const pageNumber = item.pageNumber;
      if (!isPositiveInt(pageNumber)) return null;
      if (pageNumber > docBounds.totalPhysicalPages) return null;
      if (docBounds.missingPages.has(pageNumber) || docBounds.emptyPages.has(pageNumber)) return null;

      const cov = verified.coverageByDoc.get(docId);
      if (cov) {
        if (!cov.authorizedPageNumbers.has(pageNumber) || !cov.pagesRead.has(pageNumber)) {
          return null;
        }
      }

      const quote = nonEmptyText(item.quote, MAX_QUOTE_CHARS);
      if (!quote) return null;
      const normalizedQuote = normalizeQuoteText(quote);
      if (normalizedQuote === "") return null;

      if (input.authorizedPageText) {
        const key = `${docId}:${pageNumber}`;
        const rawPage = input.authorizedPageText.get(key);
        if (typeof rawPage !== "string") return null;
        let normPage = normalizedPages.get(key);
        if (normPage === undefined) {
          normPage = normalizeQuoteText(rawPage);
          normalizedPages.set(key, normPage);
        }
        if (!normPage.includes(normalizedQuote)) return null;
      }

      const dedupeKey = `${docId}:${pageNumber}:${normalizedQuote}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        sourceDocumentId: docId,
        pageNumber,
        quote,
        sourceLabel: documentLabels[docId]!,
      });
    }
    return out.length > 0 ? out : null;
  };

  const factsById = new Map<string, LegacyAssistantVerifiedFact>();
  const briefingFacts: AssistantBriefingFact[] = [];
  let rejectedFactCount = 0;

  const recordVerifiedFact = (
    id: string,
    statement: string,
    evidence: readonly LegacyAssistantEvidenceItem[],
  ) => {
    const primary = evidence[0]!;
    factsById.set(id, {
      id,
      statement,
      sourceDocumentId: primary.sourceDocumentId,
      pageNumber: primary.pageNumber,
      sourceLabel: primary.sourceLabel,
      quote: primary.quote,
      evidence,
    });
    briefingFacts.push({
      id,
      statement,
      sourceLabel: primary.sourceLabel,
      page: primary.pageNumber,
    });
  };

  // 1. Atomic document findings (`DF…`), matching `studyClaimCatalog` order and rules.
  if (Array.isArray(inv.documentFindings)) {
    for (const rawFinding of inv.documentFindings) {
      const finding = asRecord(rawFinding);
      if (!finding) {
        rejectedFactCount += 1;
        continue;
      }
      const id = typeof finding.id === "string" ? finding.id : "";
      if (!DOCUMENT_FINDING_ID_RE.test(id) || factsById.has(id) || !verified.claimIds.has(id)) {
        rejectedFactCount += 1;
        continue;
      }
      const docId = normalizeUuid(finding.sourceDocumentId);
      if (!docId || !authorizedDocs.has(docId)) {
        rejectedFactCount += 1;
        continue;
      }
      const statement = nonEmptyText(finding.statement, MAX_STATEMENT_CHARS);
      const valueAsWritten = nonEmptyText(finding.valueAsWritten, MAX_VALUE_CHARS);
      const modality = finding.modality;
      if (
        !statement ||
        !valueAsWritten ||
        typeof modality !== "string" ||
        !(STUDY_FINDING_MODALITIES as readonly string[]).includes(modality)
      ) {
        rejectedFactCount += 1;
        continue;
      }
      const dates: string[] = [];
      if (finding.dates !== undefined) {
        if (!Array.isArray(finding.dates) || finding.dates.some((d) => typeof d !== "string")) {
          rejectedFactCount += 1;
          continue;
        }
        dates.push(...(finding.dates as string[]));
      }
      const evidence = validateEvidenceList(finding.evidence, docId);
      if (!evidence) {
        rejectedFactCount += 1;
        continue;
      }
      const ungrounded = firstUngroundedFindingNumber({
        valueAsWritten,
        statement,
        dates,
        modality: modality as StudyFindingModality,
        quotes: evidence.map((ev) => ev.quote),
      });
      if (ungrounded !== null) {
        rejectedFactCount += 1;
        continue;
      }
      recordVerifiedFact(id, statement, evidence);
    }
  }

  // 2. Question-scoped facts (`P#.F#`), preserving original `studyClaimCatalog` IDs and order.
  const seenQuestionIds = new Set<string>();
  for (const rawAnswer of inv.answers) {
    const answer = asRecord(rawAnswer);
    if (!answer) continue;
    const planQuestionId = typeof answer.planQuestionId === "string" ? answer.planQuestionId.trim() : "";
    if (
      planQuestionId === "" ||
      seenQuestionIds.has(planQuestionId) ||
      !verified.questionIds.has(planQuestionId) ||
      !verified.claimIds.has(planQuestionId)
    ) {
      if (Array.isArray(answer.facts)) rejectedFactCount += answer.facts.length;
      continue;
    }
    seenQuestionIds.add(planQuestionId);
    if (!Array.isArray(answer.facts)) continue;

    answer.facts.forEach((rawFact, factIndex) => {
      const claimId = `${planQuestionId}.F${factIndex}`;
      const fact = asRecord(rawFact);
      if (!fact || factsById.has(claimId) || !verified.claimIds.has(claimId)) {
        rejectedFactCount += 1;
        return;
      }
      const statement = nonEmptyText(fact.statement, MAX_STATEMENT_CHARS);
      if (!statement) {
        rejectedFactCount += 1;
        return;
      }
      const evidence = validateEvidenceList(fact.evidence);
      if (!evidence) {
        rejectedFactCount += 1;
        return;
      }
      recordVerifiedFact(claimId, statement, evidence);
    });
  }

  return {
    briefingFacts,
    factsById,
    documentLabels,
    rejectedFactCount,
  };
}

/**
 * Resolves a cited fact ID against verified legacy evidence into deduplicated clickable
 * `(sourceDocumentId, pageNumber)` source refs for `validateAssistantReply()`.
 */
export function mapLegacyAssistantFactRefs(
  evidence: LegacyAssistantEvidence,
  factId: string,
  studyRevisionId: string,
): Omit<AssistantSourceRef, "itemKey">[] | null {
  const fact = evidence.factsById.get(factId);
  if (!fact || fact.evidence.length === 0) return null;

  const seenPages = new Set<string>();
  const refs: Omit<AssistantSourceRef, "itemKey">[] = [];
  for (const item of fact.evidence) {
    const key = `${item.sourceDocumentId}:${item.pageNumber}`;
    if (seenPages.has(key)) continue;
    seenPages.add(key);
    refs.push({
      sourceDocumentId: item.sourceDocumentId,
      pageNumber: item.pageNumber,
      shortLabel: item.sourceLabel,
      factId: fact.id,
      studyRevisionId,
    });
  }
  return refs.length > 0 ? refs : null;
}
