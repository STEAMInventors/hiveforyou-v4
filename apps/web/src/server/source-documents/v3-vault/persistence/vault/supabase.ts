import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CaseId,
  CorrelationId,
  SourceDocumentId,
  UploadOperationId,
  UserId,
} from "@hives/contracts";
import { HiveError } from "@hives/core";
import type {
  AuditEventRepository,
  CaseRepository,
  CompletenessFindingRepository,
  DocumentRequestDispositionRepository,
  DomainResolutionRepository,
  GetCaseOptions,
  IntakeDocumentResultRepository,
  IntakeRunDocumentRepository,
  IntakeRunRepository,
  IntakeRunStepRepository,
  PersistIntakeResultInput,
  SourceDocumentRepository,
  StorageOrphanRepository,
  UploadOperationRepository,
  VaultRepositories,
  VaultStores,
} from "./ports.js";
import type {
  AuditEventRecord,
  CaseRecord,
  CompletenessFindingRecord,
  DocumentRequestDispositionRecord,
  DomainResolutionRecord,
  IntakeDocumentResultRecord,
  IntakeRunDocumentRecord,
  IntakeRunRecord,
  IntakeRunStepRecord,
  SourceDocumentRecord,
  StorageOrphanRecord,
  UploadOperationRecord,
} from "./records.js";
import { parsePersistedDomainPack } from "./domain-pack.js";
import {
  auditEventRow,
  caseRow,
  completenessFindingRow,
  domainResolutionRow,
  intakeDocumentResultRow,
  intakeRunDocumentRow,
  intakeRunRow,
  intakeRunStepRow,
  persistIntakeResultPayload,
  sourceDocumentRow,
  vaultTransactionPayload,
  type VaultTransactionOp,
} from "./rpc-payload.js";

type PostgrestErrorLike = {
  readonly message: string;
  readonly code?: string | undefined;
};

function writeFailed(correlationId: CorrelationId, cause?: unknown): HiveError {
  return new HiveError({
    code: "VAULT_WRITE_FAILED",
    category: "STORAGE_ERROR",
    message: "Vault write failed.",
    retryable: true,
    severity: "ERROR",
    correlationId,
    cause,
  });
}

function readFailed(correlationId: CorrelationId, cause?: unknown): HiveError {
  return new HiveError({
    code: "VAULT_READ_FAILED",
    category: "STORAGE_ERROR",
    message: "Vault read failed.",
    retryable: true,
    severity: "ERROR",
    correlationId,
    cause,
  });
}

function throwOnError(
  error: PostgrestErrorLike | null,
  correlationId: CorrelationId,
  kind: "read" | "write",
): void {
  if (error === null) {
    return;
  }
  throw kind === "read" ? readFailed(correlationId, error) : writeFailed(correlationId, error);
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return iso(value);
}

export class SupabaseVaultRepositories implements VaultRepositories {
  readonly cases: CaseRepository;
  readonly sourceDocuments: SourceDocumentRepository;
  readonly uploadOperations: UploadOperationRepository;
  readonly intakeRuns: IntakeRunRepository;
  readonly intakeRunSteps: IntakeRunStepRepository;
  readonly intakeRunDocuments: IntakeRunDocumentRepository;
  readonly intakeDocumentResults: IntakeDocumentResultRepository;
  readonly domainResolutions: DomainResolutionRepository;
  readonly completenessFindings: CompletenessFindingRepository;
  readonly documentRequestDispositions: DocumentRequestDispositionRepository;
  readonly auditEvents: AuditEventRepository;
  readonly storageOrphans: StorageOrphanRepository;

  constructor(
    private readonly client: SupabaseClient,
    private readonly correlationId: CorrelationId,
  ) {
    const hive = () => this.client.schema("hive");
    const supabaseClient = this.client;
    const requestCorrelationId = this.correlationId;

    this.cases = {
      async insert(record) {
        const { error } = await hive().from("cases").insert(caseRow(record));
        throwOnError(error, requestCorrelationId, "write");
      },
      async getById(id: CaseId, options?: GetCaseOptions) {
        let query = hive().from("cases").select("*").eq("id", id);
        if (options?.includeDeleted !== true) {
          query = query.is("deleted_at", null);
        }
        const { data, error } = await query.maybeSingle();
        throwOnError(error, requestCorrelationId, "read");
        return data === null ? undefined : mapCase(data);
      },
      async listByOwner(ownerUserId: UserId) {
        const { data, error } = await hive()
          .from("cases")
          .select("*")
          .eq("owner_user_id", ownerUserId)
          .is("deleted_at", null);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapCase);
      },
      async softDelete(id: CaseId, deletedAt: string) {
        const { error } = await hive()
          .from("cases")
          .update({ deleted_at: deletedAt, updated_at: deletedAt })
          .eq("id", id);
        throwOnError(error, requestCorrelationId, "write");
      },
    };

    this.sourceDocuments = {
      async insert(record) {
        const { error } = await hive().from("source_documents").insert(sourceDocumentRow(record));
        throwOnError(error, requestCorrelationId, "write");
      },
      async getById(id: SourceDocumentId) {
        const { data, error } = await hive()
          .from("source_documents")
          .select("*")
          .eq("id", id)
          .is("deleted_at", null)
          .maybeSingle();
        throwOnError(error, requestCorrelationId, "read");
        return data === null ? undefined : mapSourceDocument(data);
      },
      async listByCase(caseId: CaseId) {
        const { data, error } = await hive()
          .from("source_documents")
          .select("*")
          .eq("case_id", caseId)
          .is("deleted_at", null);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapSourceDocument);
      },
      async findBySha256(caseId: CaseId, sha256: string) {
        const { data, error } = await hive()
          .from("source_documents")
          .select("*")
          .eq("case_id", caseId)
          .eq("sha256", sha256)
          .is("deleted_at", null);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapSourceDocument);
      },
      async softDelete(id: SourceDocumentId, deletedAt: string) {
        const { error } = await hive()
          .from("source_documents")
          .update({ deleted_at: deletedAt, lifecycle_status: "SOFT_DELETED" })
          .eq("id", id);
        throwOnError(error, requestCorrelationId, "write");
      },
    };

    this.uploadOperations = {
      async insertPending(record) {
        const { error } = await supabaseClient.rpc("apply_vault_transaction", {
          payload: {
            operations: [{ op: "insert_upload_pending", row: uploadRow(record) }],
          },
        });
        throwOnError(error, requestCorrelationId, "write");
      },
      async getById(id: UploadOperationId) {
        const { data, error } = await hive()
          .from("upload_operations")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        throwOnError(error, requestCorrelationId, "read");
        return data === null ? undefined : mapUpload(data);
      },
      async getBySourceDocumentId(id: SourceDocumentId) {
        const { data, error } = await hive()
          .from("upload_operations")
          .select("*")
          .eq("source_document_id", id)
          .maybeSingle();
        throwOnError(error, requestCorrelationId, "read");
        return data === null ? undefined : mapUpload(data);
      },
      async getByClientRequestId(ownerUserId, caseId, clientRequestId) {
        const { data, error } = await supabaseClient.rpc("get_source_upload_by_client_request", {
          p_hive_id: caseId,
          p_client_request_id: clientRequestId,
          p_owner_user_id: ownerUserId,
        });
        throwOnError(error, requestCorrelationId, "read");
        return data === null ? undefined : mapUploadRpcJson(data);
      },
      async listByCase(caseId: CaseId) {
        const { data, error } = await hive()
          .from("upload_operations")
          .select("*")
          .eq("case_id", caseId);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapUpload);
      },
      async markStored(id, updatedAt) {
        const { error } = await hive()
          .from("upload_operations")
          .update({ status: "STORED", updated_at: updatedAt })
          .eq("id", id);
        throwOnError(error, requestCorrelationId, "write");
      },
      async markRegistered(id, updatedAt) {
        const { error } = await hive()
          .from("upload_operations")
          .update({ status: "REGISTERED", updated_at: updatedAt })
          .eq("id", id);
        throwOnError(error, requestCorrelationId, "write");
      },
      async markFailed(id, updatedAt, errorCode, errorCategory) {
        const { error } = await hive()
          .from("upload_operations")
          .update({
            status: "FAILED",
            updated_at: updatedAt,
            error_code: errorCode,
            error_category: errorCategory,
          })
          .eq("id", id);
        throwOnError(error, requestCorrelationId, "write");
      },
    };

    this.intakeRuns = {
      async insert(record) {
        const { error } = await hive().from("intake_runs").insert(intakeRunRow(record));
        throwOnError(error, requestCorrelationId, "write");
      },
      async getById(id) {
        const { data, error } = await hive()
          .from("intake_runs")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        throwOnError(error, requestCorrelationId, "read");
        return data === null ? undefined : mapIntakeRun(data);
      },
      async listByCase(caseId: CaseId) {
        const { data, error } = await hive().from("intake_runs").select("*").eq("case_id", caseId);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapIntakeRun);
      },
      async markCompleted(id, update) {
        const { data, error } = await hive()
          .from("intake_runs")
          .update({
            status: update.status,
            completed_at: update.completedAt,
            error_code: update.errorCode,
            error_category: update.errorCategory,
          })
          .eq("id", id)
          .eq("status", "RUNNING")
          .select("id");
        throwOnError(error, requestCorrelationId, "write");
        if (data === null || data.length === 0) {
          throw new HiveError({
            code: "INTAKE_RUN_STATUS_INVALID",
            category: "CONCURRENCY_ERROR",
            message: "Illegal intake run status transition.",
            retryable: false,
            severity: "ERROR",
            correlationId: update.correlationId,
            safeContext: { to: update.status },
          });
        }
      },
    };

    this.intakeRunSteps = {
      async insert(record) {
        const { error } = await hive().from("intake_run_steps").insert(intakeRunStepRow(record));
        throwOnError(error, requestCorrelationId, "write");
      },
      async getById(id) {
        const { data, error } = await hive()
          .from("intake_run_steps")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        throwOnError(error, requestCorrelationId, "read");
        return data === null ? undefined : mapIntakeRunStep(data);
      },
      async listByRun(intakeRunId) {
        const { data, error } = await hive()
          .from("intake_run_steps")
          .select("*")
          .eq("intake_run_id", intakeRunId)
          .order("step_order", { ascending: true });
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapIntakeRunStep);
      },
      async markCompleted(id, update) {
        const { data, error } = await hive()
          .from("intake_run_steps")
          .update({
            status: update.status,
            completed_at: update.completedAt,
            error_code: update.errorCode,
            error_category: update.errorCategory,
            safe_metadata: update.safeMetadata,
            updated_at: update.completedAt,
          })
          .eq("id", id)
          .eq("status", "RUNNING")
          .select("id");
        throwOnError(error, requestCorrelationId, "write");
        if (data === null || data.length === 0) {
          throw new HiveError({
            code: "INTAKE_RUN_STEP_STATUS_INVALID",
            category: "CONCURRENCY_ERROR",
            message: "Illegal intake run step status transition.",
            retryable: false,
            severity: "ERROR",
            correlationId: update.correlationId,
            safeContext: { to: update.status },
          });
        }
      },
    };

    this.intakeRunDocuments = {
      async insert(record) {
        const { error } = await hive()
          .from("intake_run_documents")
          .insert(intakeRunDocumentRow(record));
        throwOnError(error, requestCorrelationId, "write");
      },
      async listByRun(intakeRunId) {
        const { data, error } = await hive()
          .from("intake_run_documents")
          .select("*")
          .eq("intake_run_id", intakeRunId)
          .order("input_order", { ascending: true });
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapIntakeRunDocument);
      },
    };

    this.intakeDocumentResults = {
      async insert(record) {
        const { error } = await hive()
          .from("intake_document_results")
          .insert(intakeDocumentResultRow(record));
        throwOnError(error, requestCorrelationId, "write");
      },
      async listByRun(intakeRunId) {
        const { data, error } = await hive()
          .from("intake_document_results")
          .select("*")
          .eq("intake_run_id", intakeRunId);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapIntakeResult);
      },
    };

    this.domainResolutions = {
      async insert(record) {
        const { error } = await hive().from("domain_resolutions").insert(domainResolutionRow(record));
        throwOnError(error, requestCorrelationId, "write");
      },
      async listByRun(intakeRunId) {
        const { data, error } = await hive()
          .from("domain_resolutions")
          .select("*")
          .eq("intake_run_id", intakeRunId);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapDomainResolution);
      },
    };

    this.completenessFindings = {
      async insert(record) {
        const { error } = await hive()
          .from("completeness_findings")
          .insert(completenessFindingRow(record));
        throwOnError(error, requestCorrelationId, "write");
      },
      async listByRun(intakeRunId) {
        const { data, error } = await hive()
          .from("completeness_findings")
          .select("*")
          .eq("intake_run_id", intakeRunId);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapCompleteness);
      },
    };

    this.documentRequestDispositions = {
      async upsert(record) {
        const { error } = await hive()
          .from("document_request_dispositions")
          .upsert(
            {
              id: record.id,
              case_id: record.caseId,
              owner_user_id: record.ownerUserId,
              domain: record.domain,
              document_type: record.documentType,
              disposition: record.disposition,
              actor_user_id: record.actorUserId,
              intake_run_id: record.intakeRunId,
              created_at: record.createdAt,
              updated_at: record.updatedAt,
            },
            { onConflict: "case_id,domain,document_type" },
          );
        throwOnError(error, requestCorrelationId, "write");
      },
      async listByCase(caseId: CaseId) {
        const { data, error } = await hive()
          .from("document_request_dispositions")
          .select("*")
          .eq("case_id", caseId);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapDisposition);
      },
    };

    this.auditEvents = {
      async append(event) {
        const { error } = await hive().from("audit_events").insert(auditEventRow(event));
        throwOnError(error, requestCorrelationId, "write");
      },
      async listByCase(caseId: CaseId) {
        const { data, error } = await hive().from("audit_events").select("*").eq("case_id", caseId);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapAudit);
      },
    };

    this.storageOrphans = {
      async insert(record) {
        const { error } = await hive().from("storage_orphans").insert({
          id: record.id,
          owner_user_id: record.ownerUserId,
          case_id: record.caseId,
          source_document_id: record.sourceDocumentId,
          upload_operation_id: record.uploadOperationId,
          storage_bucket: record.storageBucket,
          storage_path: record.storagePath,
          sha256: record.sha256,
          reason: record.reason,
          created_at: record.createdAt,
          reconciled_at: record.reconciledAt,
        });
        throwOnError(error, requestCorrelationId, "write");
      },
      async listOpen() {
        const { data, error } = await hive()
          .from("storage_orphans")
          .select("*")
          .is("reconciled_at", null);
        throwOnError(error, requestCorrelationId, "read");
        return (data ?? []).map(mapOrphan);
      },
    };
  }

  async withTransaction<T>(fn: (stores: VaultStores) => Promise<T>): Promise<T> {
    const operations: VaultTransactionOp[] = [];
    const stores = createBufferedStores(this, operations, this.correlationId);
    const result = await fn(stores);
    const { error } = await this.client.rpc("apply_vault_transaction", {
      payload: vaultTransactionPayload(operations),
    });
    throwOnError(error, this.correlationId, "write");
    return result;
  }

  async persistIntakeResult(input: PersistIntakeResultInput): Promise<void> {
    const { error } = await this.client.schema("hive").rpc("persist_intake_result", {
      payload: persistIntakeResultPayload(input),
    });
    if (error !== null && /illegal intake run status transition/i.test(error.message)) {
      throw new HiveError({
        code: "INTAKE_RUN_STATUS_INVALID",
        category: "CONCURRENCY_ERROR",
        message: "Illegal intake run status transition.",
        retryable: false,
        severity: "ERROR",
        correlationId: input.runCompletion.correlationId,
        safeContext: { to: input.runCompletion.status },
      });
    }
    throwOnError(error, this.correlationId, "write");
  }
}

function persistMustUseRpc(correlationId: CorrelationId): HiveError {
  return new HiveError({
    code: "VAULT_WRITE_FAILED",
    category: "STORAGE_ERROR",
    message: "Intake result persistence must use persistIntakeResult.",
    retryable: false,
    severity: "ERROR",
    correlationId,
  });
}

function createBufferedStores(
  live: VaultStores,
  operations: VaultTransactionOp[],
  correlationId: CorrelationId,
): VaultStores {
  return {
    cases: {
      ...live.cases,
      async insert(record) {
        operations.push({ op: "insert_case", row: caseRow(record) });
      },
    },
    sourceDocuments: {
      ...live.sourceDocuments,
      async insert(record) {
        operations.push({ op: "insert_source_document", row: sourceDocumentRow(record) });
      },
    },
    uploadOperations: {
      ...live.uploadOperations,
      async markRegistered(id, updatedAt) {
        operations.push({ op: "mark_upload_registered", row: { id, updated_at: updatedAt } });
      },
    },
    intakeRuns: {
      ...live.intakeRuns,
      async insert(record) {
        operations.push({ op: "insert_intake_run", row: intakeRunRow(record) });
      },
      async markCompleted(id, update) {
        operations.push({
          op: "update_intake_run",
          row: {
            id,
            status: update.status,
            completed_at: update.completedAt,
            error_code: update.errorCode,
            error_category: update.errorCategory,
          },
        });
      },
    },
    intakeRunSteps: {
      ...live.intakeRunSteps,
      async insert(record) {
        operations.push({ op: "insert_intake_run_step", row: intakeRunStepRow(record) });
      },
      async markCompleted(id, update) {
        operations.push({
          op: "update_intake_run_step",
          row: {
            id,
            status: update.status,
            completed_at: update.completedAt,
            error_code: update.errorCode,
            error_category: update.errorCategory,
            safe_metadata: update.safeMetadata,
          },
        });
      },
    },
    intakeRunDocuments: {
      ...live.intakeRunDocuments,
      async insert(record) {
        operations.push({ op: "insert_intake_run_document", row: intakeRunDocumentRow(record) });
      },
    },
    intakeDocumentResults: {
      ...live.intakeDocumentResults,
      async insert() {
        throw persistMustUseRpc(correlationId);
      },
    },
    domainResolutions: {
      ...live.domainResolutions,
      async insert() {
        throw persistMustUseRpc(correlationId);
      },
    },
    completenessFindings: {
      ...live.completenessFindings,
      async insert() {
        throw persistMustUseRpc(correlationId);
      },
    },
    documentRequestDispositions: live.documentRequestDispositions,
    auditEvents: {
      ...live.auditEvents,
      async append(event) {
        operations.push({ op: "append_audit", row: auditEventRow(event) });
      },
    },
    storageOrphans: live.storageOrphans,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function str(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "");
}

function strOrNull(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function num(row: Record<string, unknown>, key: string): number {
  return Number(row[key] ?? 0);
}

function numOrNull(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return value === null || value === undefined ? null : Number(value);
}

function mapCase(raw: unknown): CaseRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as CaseRecord["id"],
    ownerUserId: str(row, "owner_user_id") as CaseRecord["ownerUserId"],
    tenantId: strOrNull(row, "tenant_id") as CaseRecord["tenantId"],
    title: str(row, "title"),
    domain: strOrNull(row, "domain"),
    status: str(row, "status") as CaseRecord["status"],
    createdAt: iso(str(row, "created_at")),
    updatedAt: iso(str(row, "updated_at")),
    deletedAt: isoOrNull(strOrNull(row, "deleted_at")),
  };
}

function mapSourceDocument(raw: unknown): SourceDocumentRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as SourceDocumentRecord["id"],
    caseId: str(row, "case_id") as SourceDocumentRecord["caseId"],
    ownerUserId: str(row, "owner_user_id") as SourceDocumentRecord["ownerUserId"],
    originalFilename: str(row, "original_filename"),
    mimeType: str(row, "mime_type"),
    byteSize: num(row, "byte_size"),
    sha256: str(row, "sha256"),
    storageBucket: str(row, "storage_bucket"),
    storagePath: str(row, "storage_path"),
    pageCount: numOrNull(row, "page_count"),
    uploadStatus: str(row, "upload_status") as SourceDocumentRecord["uploadStatus"],
    lifecycleStatus: str(row, "lifecycle_status") as SourceDocumentRecord["lifecycleStatus"],
    createdAt: iso(str(row, "created_at")),
    deletedAt: isoOrNull(strOrNull(row, "deleted_at")),
  };
}

function uploadRow(record: UploadOperationRecord): Record<string, unknown> {
  return {
    id: record.id,
    case_id: record.caseId,
    owner_user_id: record.ownerUserId,
    source_document_id: record.sourceDocumentId,
    original_filename: record.originalFilename,
    mime_type: record.mimeType,
    byte_size: record.byteSize,
    sha256: record.sha256,
    storage_bucket: record.storageBucket,
    storage_path: record.storagePath,
    status: record.status,
    error_code: record.errorCode,
    error_category: record.errorCategory,
    client_request_id: record.clientRequestId ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function mapUploadRpcJson(raw: unknown): UploadOperationRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as UploadOperationRecord["id"],
    caseId: str(row, "caseId") as UploadOperationRecord["caseId"],
    ownerUserId: str(row, "ownerUserId") as UploadOperationRecord["ownerUserId"],
    sourceDocumentId: str(row, "sourceDocumentId") as UploadOperationRecord["sourceDocumentId"],
    originalFilename: str(row, "originalFilename"),
    mimeType: str(row, "mimeType"),
    byteSize: num(row, "byteSize"),
    sha256: str(row, "sha256"),
    storageBucket: str(row, "storageBucket"),
    storagePath: str(row, "storagePath"),
    status: str(row, "status") as UploadOperationRecord["status"],
    errorCode: strOrNull(row, "errorCode"),
    errorCategory: strOrNull(row, "errorCategory") as UploadOperationRecord["errorCategory"],
    clientRequestId: strOrNull(row, "clientRequestId"),
    createdAt: iso(str(row, "createdAt")),
    updatedAt: iso(str(row, "updatedAt")),
  };
}

function mapUpload(raw: unknown): UploadOperationRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as UploadOperationRecord["id"],
    caseId: str(row, "case_id") as UploadOperationRecord["caseId"],
    ownerUserId: str(row, "owner_user_id") as UploadOperationRecord["ownerUserId"],
    sourceDocumentId: str(row, "source_document_id") as UploadOperationRecord["sourceDocumentId"],
    originalFilename: str(row, "original_filename"),
    mimeType: str(row, "mime_type"),
    byteSize: num(row, "byte_size"),
    sha256: str(row, "sha256"),
    storageBucket: str(row, "storage_bucket"),
    storagePath: str(row, "storage_path"),
    status: str(row, "status") as UploadOperationRecord["status"],
    errorCode: strOrNull(row, "error_code"),
    errorCategory: strOrNull(row, "error_category") as UploadOperationRecord["errorCategory"],
    clientRequestId: strOrNull(row, "client_request_id"),
    createdAt: iso(str(row, "created_at")),
    updatedAt: iso(str(row, "updated_at")),
  };
}

function mapIntakeRun(raw: unknown): IntakeRunRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as IntakeRunRecord["id"],
    caseId: str(row, "case_id") as IntakeRunRecord["caseId"],
    status: str(row, "status") as IntakeRunRecord["status"],
    engineVersion: str(row, "engine_version"),
    domainIntakeManifestVersion: str(row, "domain_intake_manifest_version"),
    domainIntakeManifestChecksum: str(row, "domain_intake_manifest_checksum"),
    modelProvider: strOrNull(row, "model_provider"),
    modelName: strOrNull(row, "model_name"),
    modelVersion: strOrNull(row, "model_version"),
    promptVersion: strOrNull(row, "prompt_version"),
    startedAt: iso(str(row, "started_at")),
    completedAt: isoOrNull(strOrNull(row, "completed_at")),
    errorCode: strOrNull(row, "error_code"),
    errorCategory: strOrNull(row, "error_category") as IntakeRunRecord["errorCategory"],
    createdAt: iso(str(row, "created_at")),
  };
}

function metadata(row: Record<string, unknown>, key: string): IntakeRunStepRecord["safeMetadata"] {
  const value = row[key];
  if (value !== null && typeof value === "object") {
    return value as IntakeRunStepRecord["safeMetadata"];
  }
  return {};
}

function mapIntakeRunStep(raw: unknown): IntakeRunStepRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as IntakeRunStepRecord["id"],
    caseId: str(row, "case_id") as IntakeRunStepRecord["caseId"],
    intakeRunId: str(row, "intake_run_id") as IntakeRunStepRecord["intakeRunId"],
    stepOrder: num(row, "step_order"),
    stepType: str(row, "step_type"),
    status: str(row, "status") as IntakeRunStepRecord["status"],
    startedAt: isoOrNull(strOrNull(row, "started_at")),
    completedAt: isoOrNull(strOrNull(row, "completed_at")),
    errorCode: strOrNull(row, "error_code"),
    errorCategory: strOrNull(row, "error_category") as IntakeRunStepRecord["errorCategory"],
    safeMetadata: metadata(row, "safe_metadata"),
    createdAt: iso(str(row, "created_at")),
    updatedAt: iso(str(row, "updated_at")),
  };
}

function mapIntakeRunDocument(raw: unknown): IntakeRunDocumentRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as IntakeRunDocumentRecord["id"],
    intakeRunId: str(row, "intake_run_id") as IntakeRunDocumentRecord["intakeRunId"],
    caseId: str(row, "case_id") as IntakeRunDocumentRecord["caseId"],
    sourceDocumentId: str(row, "source_document_id") as IntakeRunDocumentRecord["sourceDocumentId"],
    inputOrder: num(row, "input_order"),
    createdAt: iso(str(row, "created_at")),
  };
}

function mapIntakeResult(raw: unknown): IntakeDocumentResultRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id"),
    caseId: str(row, "case_id") as IntakeDocumentResultRecord["caseId"],
    intakeRunId: str(row, "intake_run_id") as IntakeDocumentResultRecord["intakeRunId"],
    sourceDocumentId: str(row, "source_document_id") as IntakeDocumentResultRecord["sourceDocumentId"],
    logicalDocumentIndex: num(row, "logical_document_index"),
    proposedDomain: strOrNull(row, "proposed_domain"),
    proposedDocumentType: strOrNull(row, "proposed_document_type"),
    relevanceStatus: str(row, "relevance_status") as IntakeDocumentResultRecord["relevanceStatus"],
    relevanceReason: strOrNull(row, "relevance_reason"),
    detectedDocumentDate: strOrNull(row, "detected_document_date"),
    duplicateOfSourceDocumentId: strOrNull(
      row,
      "duplicate_of_source_document_id",
    ) as IntakeDocumentResultRecord["duplicateOfSourceDocumentId"],
    versionOfSourceDocumentId: strOrNull(
      row,
      "version_of_source_document_id",
    ) as IntakeDocumentResultRecord["versionOfSourceDocumentId"],
    modelConfidence: numOrNull(row, "model_confidence"),
    validatedStatus: str(row, "validated_status") as IntakeDocumentResultRecord["validatedStatus"],
    startPage: numOrNull(row, "start_page"),
    endPage: numOrNull(row, "end_page"),
    createdAt: iso(str(row, "created_at")),
  };
}

function mapDomainResolution(raw: unknown): DomainResolutionRecord {
  const row = asRecord(raw);
  const candidates = row.candidate_domains;
  return {
    id: str(row, "id") as DomainResolutionRecord["id"],
    intakeRunId: str(row, "intake_run_id") as DomainResolutionRecord["intakeRunId"],
    resolutionStatus: str(row, "resolution_status") as DomainResolutionRecord["resolutionStatus"],
    resolvedDomain: strOrNull(row, "resolved_domain"),
    candidateDomains: Array.isArray(candidates)
      ? (candidates as DomainResolutionRecord["candidateDomains"])
      : [],
    validationStatus: str(row, "validation_status"),
    domainPack: parsePersistedDomainPack(row.domain_pack),
    createdAt: iso(str(row, "created_at")),
  };
}

function mapCompleteness(raw: unknown): CompletenessFindingRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as CompletenessFindingRecord["id"],
    intakeRunId: str(row, "intake_run_id") as CompletenessFindingRecord["intakeRunId"],
    domain: str(row, "domain"),
    documentType: str(row, "document_type"),
    findingType: str(row, "finding_type") as CompletenessFindingRecord["findingType"],
    completenessStatus: str(row, "completeness_status") as CompletenessFindingRecord["completenessStatus"],
    severity: str(row, "severity") as CompletenessFindingRecord["severity"],
    sourceRuleId: strOrNull(row, "source_rule_id"),
    sourcePackId: strOrNull(row, "source_pack_id"),
    sourcePackVersion: strOrNull(row, "source_pack_version"),
    userMessage: strOrNull(row, "user_message"),
    processingAllowed: Boolean(row.processing_allowed),
    createdAt: iso(str(row, "created_at")),
  };
}

function mapDisposition(raw: unknown): DocumentRequestDispositionRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as DocumentRequestDispositionRecord["id"],
    caseId: str(row, "case_id") as DocumentRequestDispositionRecord["caseId"],
    ownerUserId: str(row, "owner_user_id") as DocumentRequestDispositionRecord["ownerUserId"],
    domain: str(row, "domain"),
    documentType: str(row, "document_type"),
    disposition: str(row, "disposition") as DocumentRequestDispositionRecord["disposition"],
    actorUserId: strOrNull(row, "actor_user_id") as DocumentRequestDispositionRecord["actorUserId"],
    intakeRunId: strOrNull(row, "intake_run_id") as DocumentRequestDispositionRecord["intakeRunId"],
    createdAt: iso(str(row, "created_at")),
    updatedAt: iso(str(row, "updated_at")),
  };
}

function mapAudit(raw: unknown): AuditEventRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as AuditEventRecord["id"],
    ownerUserId: str(row, "owner_user_id") as AuditEventRecord["ownerUserId"],
    caseId: strOrNull(row, "case_id") as AuditEventRecord["caseId"],
    sourceDocumentId: strOrNull(row, "source_document_id") as AuditEventRecord["sourceDocumentId"],
    intakeRunId: strOrNull(row, "intake_run_id") as AuditEventRecord["intakeRunId"],
    eventType: str(row, "event_type") as AuditEventRecord["eventType"],
    actorUserId: strOrNull(row, "actor_user_id") as AuditEventRecord["actorUserId"],
    actorType: str(row, "actor_type") as AuditEventRecord["actorType"],
    correlationId: strOrNull(row, "correlation_id") as AuditEventRecord["correlationId"],
    safeMetadata: metadata(row, "safe_metadata"),
    createdAt: iso(str(row, "created_at")),
  };
}

function mapOrphan(raw: unknown): StorageOrphanRecord {
  const row = asRecord(raw);
  return {
    id: str(row, "id") as StorageOrphanRecord["id"],
    ownerUserId: str(row, "owner_user_id") as StorageOrphanRecord["ownerUserId"],
    caseId: str(row, "case_id") as StorageOrphanRecord["caseId"],
    sourceDocumentId: str(row, "source_document_id") as StorageOrphanRecord["sourceDocumentId"],
    uploadOperationId: strOrNull(row, "upload_operation_id") as StorageOrphanRecord["uploadOperationId"],
    storageBucket: str(row, "storage_bucket"),
    storagePath: str(row, "storage_path"),
    sha256: str(row, "sha256"),
    reason: str(row, "reason"),
    createdAt: iso(str(row, "created_at")),
    reconciledAt: isoOrNull(strOrNull(row, "reconciled_at")),
  };
}
