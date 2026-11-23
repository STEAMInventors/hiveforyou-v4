import {
  buildLegacyAssistantEvidence,
  isValidUuid,
  type LegacyAssistantEvidence,
  type LegacyAuthorizedSnapshotDocument,
  type StudyRevisionFormat,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LoadAcceptedLegacyAssistantEvidenceInput = {
  readonly hiveId: string;
  readonly expectedRevision: {
    readonly id: string;
    readonly canonicalStudyId: string;
    readonly revisionNumber: number;
    readonly processingRunId: string;
    readonly format?: StudyRevisionFormat;
  };
  /** Currently active eligible documents in the Hive (from `get_study_preparation`). */
  readonly activeEligibleDocuments: readonly {
    readonly sourceDocumentId: string;
    readonly totalPhysicalPages: number;
  }[];
};

export type LegacyAssistantEvidenceFailureReason =
  | "canonical_format"
  | "invalid_identity"
  | "schema_client_unavailable"
  | "canonical_study_not_found"
  | "revision_not_current"
  | "revision_not_found"
  | "revision_identity_mismatch"
  | "processing_run_not_found"
  | "processing_run_not_succeeded"
  | "snapshot_unavailable"
  | "verification_invalid";

export type LoadAcceptedLegacyAssistantEvidenceResult =
  | { readonly ok: true; readonly evidence: LegacyAssistantEvidence }
  | { readonly ok: false; readonly reason: LegacyAssistantEvidenceFailureReason };

type CanonicalStudyRow = {
  id?: unknown;
  hive_id?: unknown;
  current_revision_id?: unknown;
};

type StudyRevisionRow = {
  id?: unknown;
  canonical_study_id?: unknown;
  hive_id?: unknown;
  revision_number?: unknown;
  processing_run_id?: unknown;
  format?: unknown;
  investigation?: unknown;
  verification?: unknown;
};

type ProcessingRunRow = {
  id?: unknown;
  hive_id?: unknown;
  status?: unknown;
  authorized_source_document_ids?: unknown;
  source_snapshot?: unknown;
};

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return isValidUuid(trimmed) ? trimmed : null;
}

function positiveIntArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    if (typeof item === "number" && Number.isInteger(item) && item >= 1) {
      out.push(item);
    }
  }
  return out;
}

function buildSnapshotAuthorizedDocuments(
  runRow: ProcessingRunRow,
  activeEligibleDocuments: LoadAcceptedLegacyAssistantEvidenceInput["activeEligibleDocuments"],
): LegacyAuthorizedSnapshotDocument[] {
  if (!Array.isArray(runRow.authorized_source_document_ids) || runRow.authorized_source_document_ids.length === 0) {
    return [];
  }
  const frozenIds = new Set<string>();
  for (const rawId of runRow.authorized_source_document_ids) {
    const id = normalizeUuid(rawId);
    if (id) frozenIds.add(id);
  }
  if (frozenIds.size === 0) return [];

  const activePagesByDoc = new Map<string, number>();
  for (const doc of activeEligibleDocuments) {
    const id = normalizeUuid(doc.sourceDocumentId);
    if (!id) continue;
    if (typeof doc.totalPhysicalPages === "number" && Number.isInteger(doc.totalPhysicalPages) && doc.totalPhysicalPages >= 1) {
      activePagesByDoc.set(id, doc.totalPhysicalPages);
    }
  }
  if (activePagesByDoc.size === 0) return [];

  const snapshot =
    runRow.source_snapshot && typeof runRow.source_snapshot === "object" && !Array.isArray(runRow.source_snapshot)
      ? (runRow.source_snapshot as { documents?: unknown })
      : null;
  if (!snapshot || !Array.isArray(snapshot.documents) || snapshot.documents.length === 0) {
    return [];
  }

  const out: LegacyAuthorizedSnapshotDocument[] = [];
  const seen = new Set<string>();
  for (const rawDoc of snapshot.documents) {
    if (!rawDoc || typeof rawDoc !== "object" || Array.isArray(rawDoc)) continue;
    const doc = rawDoc as {
      sourceDocumentId?: unknown;
      totalPhysicalPages?: unknown;
      missingPageNumbers?: unknown;
      emptyPageNumbers?: unknown;
    };
    const id = normalizeUuid(doc.sourceDocumentId);
    if (!id || seen.has(id)) continue;
    if (!frozenIds.has(id)) continue;
    const activePages = activePagesByDoc.get(id);
    if (activePages === undefined) continue;
    const snapPages = doc.totalPhysicalPages;
    if (typeof snapPages !== "number" || !Number.isInteger(snapPages) || snapPages < 1) continue;
    seen.add(id);
    out.push({
      sourceDocumentId: id,
      totalPhysicalPages: Math.min(snapPages, activePages),
      missingPageNumbers: positiveIntArray(doc.missingPageNumbers),
      emptyPageNumbers: positiveIntArray(doc.emptyPageNumbers),
    });
  }
  return out;
}

/**
 * Loads the accepted legacy (`investigation-1`) study's `investigation`, persisted `verification`,
 * and frozen snapshot through the caller's authenticated, Hive-member RLS-scoped Supabase client.
 *
 * Never uses a service-role client. Confirms `canonical_studies.current_revision_id`, revision
 * ownership/identity, and `processing_runs.status = 'SUCCEEDED'` before adapting verified `FACT`
 * claims. Fails closed on any mismatch or missing verification.
 */
export async function loadAcceptedLegacyAssistantEvidence(
  userClient: SupabaseClient,
  input: LoadAcceptedLegacyAssistantEvidenceInput,
): Promise<LoadAcceptedLegacyAssistantEvidenceResult> {
  if (input.expectedRevision.format === "canonical-study-1") {
    return { ok: false, reason: "canonical_format" };
  }

  const hiveId = normalizeUuid(input.hiveId);
  const expectedRevisionId = normalizeUuid(input.expectedRevision.id);
  const expectedCanonicalStudyId = normalizeUuid(input.expectedRevision.canonicalStudyId);
  const expectedProcessingRunId = normalizeUuid(input.expectedRevision.processingRunId);
  if (
    !hiveId ||
    !expectedRevisionId ||
    !expectedCanonicalStudyId ||
    !expectedProcessingRunId ||
    !Number.isInteger(input.expectedRevision.revisionNumber) ||
    input.expectedRevision.revisionNumber < 1
  ) {
    return { ok: false, reason: "invalid_identity" };
  }

  if (typeof userClient.schema !== "function") {
    return { ok: false, reason: "schema_client_unavailable" };
  }

  const hiveSchema = userClient.schema("hive");

  const { data: canonicalData, error: canonicalError } = await hiveSchema
    .from("canonical_studies")
    .select("id,hive_id,current_revision_id")
    .eq("hive_id", hiveId)
    .maybeSingle();

  if (canonicalError || !canonicalData || typeof canonicalData !== "object") {
    return { ok: false, reason: "canonical_study_not_found" };
  }
  const canonicalRow = canonicalData as CanonicalStudyRow;
  if (
    normalizeUuid(canonicalRow.hive_id) !== hiveId ||
    normalizeUuid(canonicalRow.id) !== expectedCanonicalStudyId ||
    normalizeUuid(canonicalRow.current_revision_id) !== expectedRevisionId
  ) {
    return { ok: false, reason: "revision_not_current" };
  }

  const { data: revisionData, error: revisionError } = await hiveSchema
    .from("study_revisions")
    .select("id,canonical_study_id,hive_id,revision_number,processing_run_id,format,investigation,verification")
    .eq("id", expectedRevisionId)
    .eq("hive_id", hiveId)
    .maybeSingle();

  if (revisionError || !revisionData || typeof revisionData !== "object") {
    return { ok: false, reason: "revision_not_found" };
  }
  const revisionRow = revisionData as StudyRevisionRow;
  const rowFormat = revisionRow.format;
  if (rowFormat === "canonical-study-1") {
    return { ok: false, reason: "canonical_format" };
  }
  if (
    normalizeUuid(revisionRow.id) !== expectedRevisionId ||
    normalizeUuid(revisionRow.hive_id) !== hiveId ||
    normalizeUuid(revisionRow.canonical_study_id) !== expectedCanonicalStudyId ||
    revisionRow.revision_number !== input.expectedRevision.revisionNumber ||
    normalizeUuid(revisionRow.processing_run_id) !== expectedProcessingRunId ||
    (rowFormat !== undefined && rowFormat !== null && rowFormat !== "investigation-1")
  ) {
    return { ok: false, reason: "revision_identity_mismatch" };
  }

  const { data: runData, error: runError } = await hiveSchema
    .from("processing_runs")
    .select("id,hive_id,status,authorized_source_document_ids,source_snapshot")
    .eq("id", expectedProcessingRunId)
    .eq("hive_id", hiveId)
    .maybeSingle();

  if (runError || !runData || typeof runData !== "object") {
    return { ok: false, reason: "processing_run_not_found" };
  }
  const runRow = runData as ProcessingRunRow;
  if (
    normalizeUuid(runRow.id) !== expectedProcessingRunId ||
    normalizeUuid(runRow.hive_id) !== hiveId ||
    runRow.status !== "SUCCEEDED"
  ) {
    return { ok: false, reason: "processing_run_not_succeeded" };
  }

  const authorizedDocuments = buildSnapshotAuthorizedDocuments(runRow, input.activeEligibleDocuments);
  if (authorizedDocuments.length === 0) {
    return { ok: false, reason: "snapshot_unavailable" };
  }

  const evidence = buildLegacyAssistantEvidence({
    expectedProcessingRunId,
    investigation: revisionRow.investigation,
    verification: revisionRow.verification,
    authorizedDocuments,
  });
  if (evidence.briefingFacts.length === 0) {
    return { ok: false, reason: "verification_invalid" };
  }

  return { ok: true, evidence };
}
