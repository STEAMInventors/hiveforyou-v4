import type {
  CaseId,
  CorrelationId,
  ErrorCategory,
  SourceDocumentId,
  UploadOperationId,
} from "@hives/contracts";
import { HiveError } from "@hives/core";
import type {
  AuditEventRepository,
  CaseRepository,
  CompletenessFindingRepository,
  DocumentRequestDispositionRepository,
  DomainResolutionRepository,
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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function writeBlocked(correlationId: CorrelationId): HiveError {
  return new HiveError({
    code: "VAULT_WRITE_FAILED",
    category: "STORAGE_ERROR",
    message: "Vault write failed.",
    retryable: true,
    severity: "ERROR",
    correlationId,
  });
}

export class InMemoryVaultRepositories implements VaultRepositories {
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

  writesDisabled = false;
  failNextSourceInsert = false;
  disableWritesOnNextSourceInsert = false;

  private readonly caseStore = new Map<CaseId, CaseRecord>();
  private readonly documentStore = new Map<SourceDocumentId, SourceDocumentRecord>();
  private readonly uploadStore = new Map<UploadOperationId, UploadOperationRecord>();
  private readonly intakeRunStore = new Map<IntakeRunRecord["id"], IntakeRunRecord>();
  private readonly intakeRunStepStore = new Map<IntakeRunStepRecord["id"], IntakeRunStepRecord>();
  private readonly intakeRunDocumentStore: IntakeRunDocumentRecord[] = [];
  private readonly intakeResultStore: IntakeDocumentResultRecord[] = [];
  private readonly domainResolutionStore: DomainResolutionRecord[] = [];
  private readonly completenessStore: CompletenessFindingRecord[] = [];
  private readonly dispositionStore: DocumentRequestDispositionRecord[] = [];
  readonly auditLog: AuditEventRecord[] = [];
  private readonly orphanStore = new Map<StorageOrphanRecord["id"], StorageOrphanRecord>();

  constructor(private readonly correlationId: CorrelationId) {
    // Port object literals close over the vault instance.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.cases = {
      async insert(record) {
        self.assertWritable();
        self.caseStore.set(record.id, record);
      },
      async getById(id, options) {
        const found = self.caseStore.get(id);
        if (found === undefined) {
          return undefined;
        }
        if (found.deletedAt !== null && options?.includeDeleted !== true) {
          return undefined;
        }
        return found;
      },
      async listByOwner(ownerUserId) {
        return [...self.caseStore.values()].filter(
          (item) => item.ownerUserId === ownerUserId && item.deletedAt === null,
        );
      },
      async softDelete(id, deletedAt) {
        self.assertWritable();
        const found = self.caseStore.get(id);
        if (found === undefined) {
          return;
        }
        self.caseStore.set(id, { ...found, deletedAt, updatedAt: deletedAt });
      },
    };
    this.sourceDocuments = {
      async insert(record) {
        if (self.failNextSourceInsert) {
          self.failNextSourceInsert = false;
          if (self.disableWritesOnNextSourceInsert) {
            self.writesDisabled = true;
          }
          throw writeBlocked(self.correlationId);
        }
        self.assertWritable();
        self.documentStore.set(record.id, record);
      },
      async getById(id) {
        const found = self.documentStore.get(id);
        if (found === undefined || found.deletedAt !== null) {
          return undefined;
        }
        return found;
      },
      async listByCase(caseId) {
        return [...self.documentStore.values()].filter(
          (item) => item.caseId === caseId && item.deletedAt === null,
        );
      },
      async findBySha256(caseId, sha256) {
        return [...self.documentStore.values()].filter(
          (item) => item.caseId === caseId && item.sha256 === sha256 && item.deletedAt === null,
        );
      },
      async softDelete(id, deletedAt) {
        self.assertWritable();
        const found = self.documentStore.get(id);
        if (found === undefined) {
          return;
        }
        self.documentStore.set(id, {
          ...found,
          deletedAt,
          lifecycleStatus: "SOFT_DELETED",
        });
      },
    };
    this.uploadOperations = {
      async insertPending(record) {
        self.assertWritable();
        self.uploadStore.set(record.id, { ...record, status: "PENDING" });
      },
      async getById(id) {
        return self.uploadStore.get(id);
      },
      async getBySourceDocumentId(id) {
        return [...self.uploadStore.values()].find((item) => item.sourceDocumentId === id);
      },
      async listByCase(caseId) {
        return [...self.uploadStore.values()].filter((item) => item.caseId === caseId);
      },
      async markStored(id, updatedAt) {
        self.assertWritable();
        self.transition(id, "STORED", updatedAt);
      },
      async markRegistered(id, updatedAt) {
        self.assertWritable();
        self.transition(id, "REGISTERED", updatedAt);
      },
      async markFailed(id, updatedAt, errorCode, errorCategory) {
        self.assertWritable();
        const current = self.uploadStore.get(id);
        if (current === undefined) {
          return;
        }
        self.transition(id, "FAILED", updatedAt, errorCode, errorCategory);
      },
    };
    this.intakeRuns = {
      async insert(record) {
        self.assertWritable();
        self.intakeRunStore.set(record.id, record);
      },
      async getById(id) {
        return self.intakeRunStore.get(id);
      },
      async listByCase(caseId) {
        return [...self.intakeRunStore.values()].filter((item) => item.caseId === caseId);
      },
      async markCompleted(id, update) {
        self.assertWritable();
        const current = self.intakeRunStore.get(id);
        if (current === undefined || current.status !== "RUNNING") {
          throw new HiveError({
            code: "INTAKE_RUN_STATUS_INVALID",
            category: "CONCURRENCY_ERROR",
            message: "Illegal intake run status transition.",
            retryable: false,
            severity: "ERROR",
            correlationId: update.correlationId,
            safeContext: {
              from: current?.status ?? "missing",
              to: update.status,
            },
          });
        }
        self.intakeRunStore.set(id, {
          ...current,
          status: update.status,
          completedAt: update.completedAt,
          errorCode: update.errorCode,
          errorCategory: update.errorCategory,
        });
      },
    };
    this.intakeRunSteps = {
      async insert(record) {
        self.assertWritable();
        self.intakeRunStepStore.set(record.id, record);
      },
      async getById(id) {
        return self.intakeRunStepStore.get(id);
      },
      async listByRun(intakeRunId) {
        return [...self.intakeRunStepStore.values()]
          .filter((item) => item.intakeRunId === intakeRunId)
          .sort((a, b) => a.stepOrder - b.stepOrder);
      },
      async markCompleted(id, update) {
        self.assertWritable();
        const current = self.intakeRunStepStore.get(id);
        if (current === undefined || current.status !== "RUNNING") {
          throw new HiveError({
            code: "INTAKE_RUN_STEP_STATUS_INVALID",
            category: "CONCURRENCY_ERROR",
            message: "Illegal intake run step status transition.",
            retryable: false,
            severity: "ERROR",
            correlationId: update.correlationId,
            safeContext: {
              from: current?.status ?? "missing",
              to: update.status,
            },
          });
        }
        self.intakeRunStepStore.set(id, {
          ...current,
          status: update.status,
          completedAt: update.completedAt,
          errorCode: update.errorCode,
          errorCategory: update.errorCategory,
          safeMetadata: update.safeMetadata,
          updatedAt: update.completedAt,
        });
      },
    };
    this.intakeRunDocuments = {
      async insert(record) {
        self.assertWritable();
        self.intakeRunDocumentStore.push(record);
      },
      async listByRun(intakeRunId) {
        return self.intakeRunDocumentStore
          .filter((item) => item.intakeRunId === intakeRunId)
          .sort((a, b) => a.inputOrder - b.inputOrder);
      },
    };
    this.intakeDocumentResults = {
      async insert(record) {
        self.assertWritable();
        self.intakeResultStore.push(record);
      },
      async listByRun(intakeRunId) {
        return self.intakeResultStore.filter((item) => item.intakeRunId === intakeRunId);
      },
    };
    this.domainResolutions = {
      async insert(record) {
        self.assertWritable();
        self.domainResolutionStore.push(record);
      },
      async listByRun(intakeRunId) {
        return self.domainResolutionStore.filter((item) => item.intakeRunId === intakeRunId);
      },
    };
    this.completenessFindings = {
      async insert(record) {
        self.assertWritable();
        self.completenessStore.push(record);
      },
      async listByRun(intakeRunId) {
        return self.completenessStore.filter((item) => item.intakeRunId === intakeRunId);
      },
    };
    this.documentRequestDispositions = {
      async upsert(record) {
        self.assertWritable();
        const index = self.dispositionStore.findIndex(
          (item) =>
            item.caseId === record.caseId &&
            item.domain === record.domain &&
            item.documentType === record.documentType,
        );
        if (index === -1) {
          self.dispositionStore.push(record);
          return;
        }
        const current = self.dispositionStore[index];
        if (current === undefined) {
          self.dispositionStore.push(record);
          return;
        }
        self.dispositionStore[index] = {
          ...record,
          id: current.id,
          createdAt: current.createdAt,
        };
      },
      async listByCase(caseId) {
        return self.dispositionStore.filter((item) => item.caseId === caseId);
      },
    };
    this.auditEvents = {
      async append(event) {
        self.assertWritable();
        self.auditLog.push(event);
      },
      async listByCase(caseId) {
        return self.auditLog.filter((item) => item.caseId === caseId);
      },
    };
    this.storageOrphans = {
      async insert(record) {
        self.assertWritable();
        self.orphanStore.set(record.id, record);
      },
      async listOpen() {
        return [...self.orphanStore.values()].filter((item) => item.reconciledAt === null);
      },
    };
  }

  async withTransaction<T>(fn: (stores: VaultStores) => Promise<T>): Promise<T> {
    const snapshot = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  async persistIntakeResult(input: PersistIntakeResultInput): Promise<void> {
    await this.withTransaction(async (tx) => {
      for (const row of input.documentResults) {
        await tx.intakeDocumentResults.insert(row);
      }
      await tx.domainResolutions.insert(input.domainResolution);
      for (const finding of input.completenessFindings) {
        await tx.completenessFindings.insert(finding);
      }
      await tx.intakeRuns.markCompleted(input.runCompletion.id, input.runCompletion);
      await tx.auditEvents.append(input.auditEvent);
    });
  }

  private assertWritable(): void {
    if (this.writesDisabled) {
      throw writeBlocked(this.correlationId);
    }
  }

  private transition(
    id: UploadOperationId,
    status: UploadOperationRecord["status"],
    updatedAt: string,
    errorCode?: string,
    errorCategory?: ErrorCategory,
  ): void {
    const current = this.uploadStore.get(id);
    if (current === undefined) {
      throw writeBlocked(this.correlationId);
    }
    const allowed =
      current.status === status
        ? true
        : current.status === "PENDING"
          ? status === "STORED" || status === "FAILED"
          : current.status === "STORED"
            ? status === "REGISTERED" || status === "FAILED"
            : false;
    if (!allowed) {
      throw new HiveError({
        code: "UPLOAD_STATUS_INVALID",
        category: "CONCURRENCY_ERROR",
        message: "Illegal upload operation status transition.",
        retryable: false,
        severity: "ERROR",
        correlationId: this.correlationId,
        safeContext: { from: current.status, to: status },
      });
    }
    this.uploadStore.set(id, {
      ...current,
      status,
      updatedAt,
      errorCode: errorCode ?? current.errorCode,
      errorCategory: errorCategory ?? current.errorCategory,
    });
  }

  private snapshot() {
    return {
      cases: clone([...this.caseStore.entries()]),
      documents: clone([...this.documentStore.entries()]),
      uploads: clone([...this.uploadStore.entries()]),
      intakeRuns: clone([...this.intakeRunStore.entries()]),
      intakeRunSteps: clone([...this.intakeRunStepStore.entries()]),
      intakeRunDocuments: clone(this.intakeRunDocumentStore),
      intakeResults: clone(this.intakeResultStore),
      domainResolutions: clone(this.domainResolutionStore),
      completeness: clone(this.completenessStore),
      dispositions: clone(this.dispositionStore),
      audits: clone(this.auditLog),
      orphans: clone([...this.orphanStore.entries()]),
    };
  }

  private restore(snapshot: ReturnType<InMemoryVaultRepositories["snapshot"]>): void {
    this.caseStore.clear();
    for (const [id, value] of snapshot.cases) {
      this.caseStore.set(id, value);
    }
    this.documentStore.clear();
    for (const [id, value] of snapshot.documents) {
      this.documentStore.set(id, value);
    }
    this.uploadStore.clear();
    for (const [id, value] of snapshot.uploads) {
      this.uploadStore.set(id, value);
    }
    this.intakeRunStore.clear();
    for (const [id, value] of snapshot.intakeRuns) {
      this.intakeRunStore.set(id, value);
    }
    this.intakeRunStepStore.clear();
    for (const [id, value] of snapshot.intakeRunSteps) {
      this.intakeRunStepStore.set(id, value);
    }
    this.intakeRunDocumentStore.splice(
      0,
      this.intakeRunDocumentStore.length,
      ...snapshot.intakeRunDocuments,
    );
    this.intakeResultStore.splice(0, this.intakeResultStore.length, ...snapshot.intakeResults);
    this.domainResolutionStore.splice(
      0,
      this.domainResolutionStore.length,
      ...snapshot.domainResolutions,
    );
    this.completenessStore.splice(0, this.completenessStore.length, ...snapshot.completeness);
    this.dispositionStore.splice(0, this.dispositionStore.length, ...snapshot.dispositions);
    this.auditLog.splice(0, this.auditLog.length, ...snapshot.audits);
    this.orphanStore.clear();
    for (const [id, value] of snapshot.orphans) {
      this.orphanStore.set(id, value);
    }
  }
}
