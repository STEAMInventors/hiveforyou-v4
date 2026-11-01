import type { ActorType, CaseId, CorrelationId, TenantId, UserId } from "@hives/contracts";
import { createAuditEventId, createCaseId } from "@hives/core";
import { toSafeAuditMetadata } from "./safe-metadata.js";
import type { VaultRepositories } from "./ports.js";
import type { CaseRecord } from "./records.js";

export type CreateCaseInput = {
  readonly actorUserId: UserId;
  readonly actorType: ActorType;
  readonly title: string;
  readonly correlationId: CorrelationId;
  readonly tenantId?: TenantId | null | undefined;
  readonly domain?: string | null | undefined;
  readonly caseId?: CaseId | undefined;
};

export async function createCase(
  vault: VaultRepositories,
  input: CreateCaseInput,
): Promise<CaseRecord> {
  const now = new Date().toISOString();
  const record: CaseRecord = {
    id: input.caseId ?? createCaseId(),
    ownerUserId: input.actorUserId,
    tenantId: input.tenantId ?? null,
    title: input.title,
    domain: input.domain ?? null,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await vault.withTransaction(async (tx) => {
    await tx.cases.insert(record);
    await tx.auditEvents.append({
      id: createAuditEventId(),
      ownerUserId: record.ownerUserId,
      caseId: record.id,
      sourceDocumentId: null,
      intakeRunId: null,
      eventType: "CASE_CREATED",
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      correlationId: input.correlationId,
      safeMetadata: toSafeAuditMetadata({ titleLength: record.title.length }),
      createdAt: now,
    });
  });
  return record;
}
