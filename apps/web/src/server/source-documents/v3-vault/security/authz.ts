import type { CaseId, CorrelationId, TenantId, UserId } from "@hives/contracts";
import { HiveError, type HiveErrorInput } from "@hives/core";

export type Actor = {
  readonly actorId: string;
  readonly tenantId: TenantId;
  readonly userId?: UserId | undefined;
};

export type Ownership = {
  readonly tenantId: TenantId;
  readonly caseId: CaseId;
};

export function assertOwnership(
  actor: Actor,
  resource: Ownership,
  correlationId: HiveErrorInput["correlationId"],
): void {
  if (actor.tenantId !== resource.tenantId) {
    throw new HiveError({
      code: "TENANT_ISOLATION_VIOLATION",
      category: "AUTHORIZATION_ERROR",
      message: "Actor is not authorized for this tenant.",
      retryable: false,
      severity: "FATAL",
      correlationId,
    });
  }
}

export function assertCaseOwner(
  actorUserId: UserId,
  ownerUserId: UserId,
  correlationId: CorrelationId,
): void {
  if (actorUserId !== ownerUserId) {
    throw new HiveError({
      code: "CASE_ACCESS_DENIED",
      category: "AUTHORIZATION_ERROR",
      message: "Actor is not authorized for this case.",
      retryable: false,
      severity: "FATAL",
      correlationId,
    });
  }
}

export type AuthorizationPort = {
  assertCaseAccess(actor: Actor, ownership: Ownership): Promise<void>;
};
