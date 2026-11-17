export const HIVE_NAME_MAX_LENGTH = 100;
export const HIVE_DESCRIPTION_MAX_LENGTH = 500;

import { isHiveKind } from "./hive-attention";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type HiveMembershipRole = "owner" | "professional" | "client" | "firm";

export type Hive = {
  id: string;
  hiveId: string;
  name: string;
  description: string | null;
  kind: "own" | "client";
  clientRequestId: string;
  createdAt: string;
  updatedAt: string;
  membershipRole?: HiveMembershipRole;
  isOwner?: boolean;
  memberState?: "active" | "pending" | "left" | "removed";
  ownerDisplayName?: string | null;
  clientShareStatus?: "invited" | "client_joined" | null;
  homeKicker?: string | null;
  firmId?: string | null;
  assigneeUserId?: string | null;
  assigneeDisplayName?: string | null;
  stage?: "open" | "review" | "closed";
  /** Set while permanent deletion is in progress (My Hives retry card). */
  deletingAt?: string | null;
};

export type HiveStage = "open" | "review" | "closed";

export type DeleteHiveResponse = {
  deleted: true;
};

export type ListHivesResponse = {
  hives: Hive[];
};

export type GetHiveResponse = {
  hive: Hive;
  /** Opaque stamp for client polling; changes when hive-visible data changes. */
  version?: string;
  /** When true, clients may poll more frequently (active reads). */
  fastPoll?: boolean;
};

export type CreateHiveRequest = {
  name: string;
  description?: string | null;
  clientRequestId: string;
  kind?: "own" | "client";
};

export type CreateHiveResponse = {
  hive: Hive;
  created: boolean;
};

export type ValidatedCreateHiveInput = {
  name: string;
  description: string | null;
  clientRequestId: string;
  kind: "own" | "client";
};

export type HiveValidationResult =
  | { ok: true; value: ValidatedCreateHiveInput }
  | {
      ok: false;
      message: string;
      nameError?: string;
      descriptionError?: string;
      diagnosticReason: string;
    };

export function isValidUuid(value: string): boolean {
  return value.length === 36 && UUID_REGEX.test(value);
}

export function normalizeHiveRecord(raw: unknown): Hive | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const hiveId =
    typeof record.hiveId === "string"
      ? record.hiveId.trim()
      : id;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const clientRequestId =
    typeof record.clientRequestId === "string"
      ? record.clientRequestId.trim()
      : typeof record.client_request_id === "string"
        ? record.client_request_id.trim()
        : "";
  const createdAt =
    typeof record.createdAt === "string"
      ? record.createdAt
      : typeof record.created_at === "string"
        ? record.created_at
        : "";
  const updatedAt =
    typeof record.updatedAt === "string"
      ? record.updatedAt
      : typeof record.updated_at === "string"
        ? record.updated_at
        : "";

  if (
    !isValidUuid(id) ||
    !isValidUuid(hiveId) ||
    !name ||
    name.length > HIVE_NAME_MAX_LENGTH ||
    !isValidUuid(clientRequestId) ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  let description: string | null = null;
  if (record.description !== null && record.description !== undefined) {
    if (typeof record.description !== "string") {
      return null;
    }
    const trimmedDesc = record.description.trim();
    if (trimmedDesc.length > HIVE_DESCRIPTION_MAX_LENGTH) {
      return null;
    }
    description = trimmedDesc.length > 0 ? trimmedDesc : null;
  }

  const rawKind =
    typeof record.kind === "string"
      ? record.kind.trim().toLowerCase()
      : typeof record.hiveKind === "string"
        ? record.hiveKind.trim().toLowerCase()
        : "own";
  if (!isHiveKind(rawKind)) {
    return null;
  }

  let deletingAt: string | null | undefined = undefined;
  if ("deletingAt" in record || "deleting_at" in record) {
    const raw =
      record.deletingAt !== undefined ? record.deletingAt : record.deleting_at;
    if (raw === null || raw === undefined) {
      deletingAt = null;
    } else if (typeof raw === "string" && raw.trim()) {
      deletingAt = raw;
    } else {
      return null;
    }
  }

  let membershipRole: HiveMembershipRole | undefined;
  const rawRole =
    typeof record.membershipRole === "string"
      ? record.membershipRole.trim().toLowerCase()
      : typeof record.membership_role === "string"
        ? record.membership_role.trim().toLowerCase()
        : "";
  if (rawRole === "owner" || rawRole === "professional" || rawRole === "client" || rawRole === "firm") {
    membershipRole = rawRole;
  }
  const isOwner =
    record.isOwner === true ||
    record.is_owner === true ||
    membershipRole === "owner";

  const memberStateRaw =
    typeof record.memberState === "string"
      ? record.memberState.trim().toLowerCase()
      : typeof record.member_state === "string"
        ? record.member_state.trim().toLowerCase()
        : "";
  const memberState =
    memberStateRaw === "active" ||
    memberStateRaw === "pending" ||
    memberStateRaw === "left" ||
    memberStateRaw === "removed"
      ? memberStateRaw
      : undefined;
  const ownerDisplayName =
    typeof record.ownerDisplayName === "string"
      ? record.ownerDisplayName.trim() || null
      : typeof record.owner_display_name === "string"
        ? record.owner_display_name.trim() || null
        : undefined;
  const homeKicker =
    typeof record.homeKicker === "string"
      ? record.homeKicker.trim() || null
      : typeof record.home_kicker === "string"
        ? record.home_kicker.trim() || null
        : undefined;
  const clientShareRaw =
    typeof record.clientShareStatus === "string"
      ? record.clientShareStatus.trim().toLowerCase()
      : typeof record.client_share_status === "string"
        ? record.client_share_status.trim().toLowerCase()
        : "";
  const clientShareStatus =
    clientShareRaw === "invited" || clientShareRaw === "client_joined" ? clientShareRaw : undefined;

  const rawFirmId =
    typeof record.firmId === "string"
      ? record.firmId.trim()
      : typeof record.firm_id === "string"
        ? record.firm_id.trim()
        : null;
  const firmId = rawFirmId && isValidUuid(rawFirmId) ? rawFirmId : rawFirmId === null ? null : undefined;

  const rawAssignee =
    typeof record.assigneeUserId === "string"
      ? record.assigneeUserId.trim()
      : typeof record.assignee_user_id === "string"
        ? record.assignee_user_id.trim()
        : null;
  const assigneeUserId =
    rawAssignee && isValidUuid(rawAssignee)
      ? rawAssignee
      : rawAssignee === null
        ? null
        : undefined;

  const assigneeDisplayName =
    typeof record.assigneeDisplayName === "string"
      ? record.assigneeDisplayName.trim() || null
      : typeof record.assignee_display_name === "string"
        ? record.assignee_display_name.trim() || null
        : undefined;

  const stageRaw =
    typeof record.stage === "string" ? record.stage.trim().toLowerCase() : "";
  const stage =
    stageRaw === "open" || stageRaw === "review" || stageRaw === "closed" ? stageRaw : undefined;

  return {
    id,
    hiveId,
    name,
    description,
    kind: rawKind,
    clientRequestId,
    createdAt,
    updatedAt,
    ...(membershipRole ? { membershipRole, isOwner } : isOwner ? { isOwner } : {}),
    ...(memberState ? { memberState } : {}),
    ...(ownerDisplayName !== undefined ? { ownerDisplayName } : {}),
    ...(clientShareStatus ? { clientShareStatus } : {}),
    ...(homeKicker !== undefined ? { homeKicker } : {}),
    ...(firmId !== undefined ? { firmId } : {}),
    ...(assigneeUserId !== undefined ? { assigneeUserId } : {}),
    ...(assigneeDisplayName !== undefined ? { assigneeDisplayName } : {}),
    ...(stage ? { stage } : {}),
    ...(deletingAt !== undefined ? { deletingAt } : {}),
  };
}

export function validateCreateHiveInput(body: unknown): HiveValidationResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      message: "Request body must be a JSON object.",
      diagnosticReason: "invalid_payload_shape",
    };
  }

  const record = body as Record<string, unknown>;
  const allowedKeys = new Set([
    "name",
    "description",
    "clientRequestId",
    "client_request_id",
    "kind",
  ]);

  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      return {
        ok: false,
        message: `Unexpected field: ${key}.`,
        diagnosticReason: "unexpected_field",
      };
    }
  }

  if (
    "clientRequestId" in record &&
    "client_request_id" in record &&
    record.clientRequestId !== record.client_request_id
  ) {
    return {
      ok: false,
      message: "Conflicting clientRequestId fields.",
      diagnosticReason: "invalid_client_request_id",
    };
  }

  const rawClientRequestId =
    record.clientRequestId !== undefined
      ? record.clientRequestId
      : record.client_request_id;

  if (typeof rawClientRequestId !== "string" || !rawClientRequestId.trim()) {
    return {
      ok: false,
      message: "clientRequestId is required.",
      diagnosticReason: "invalid_client_request_id",
    };
  }

  const clientRequestId = rawClientRequestId.trim().toLowerCase();
  if (!isValidUuid(clientRequestId)) {
    return {
      ok: false,
      message: "clientRequestId must be a valid UUID.",
      diagnosticReason: "invalid_client_request_id",
    };
  }

  if (typeof record.name !== "string") {
    return {
      ok: false,
      message: "Hive name is required.",
      nameError: "Give your Hive a name so you can find it later.",
      diagnosticReason: "invalid_name",
    };
  }

  let description: string | null = null;
  if (record.description !== undefined && record.description !== null) {
    if (typeof record.description !== "string") {
      return {
        ok: false,
        message: "Description must be a string.",
        descriptionError: "Description must be text.",
        diagnosticReason: "invalid_description",
      };
    }
    description = record.description;
  }

  const trimmedName = record.name.trim();
  const trimmedDescription = (description ?? "").trim();

  let nameError: string | undefined;
  let descriptionError: string | undefined;

  if (!trimmedName) {
    nameError = "Give your Hive a name so you can find it later.";
  } else if (trimmedName.length > HIVE_NAME_MAX_LENGTH) {
    nameError = `Hive name must be ${HIVE_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (trimmedDescription.length > HIVE_DESCRIPTION_MAX_LENGTH) {
    descriptionError = `Description must be ${HIVE_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  let kind: "own" | "client" = "own";
  if (record.kind !== undefined && record.kind !== null) {
    if (typeof record.kind !== "string" || !isHiveKind(record.kind.trim().toLowerCase())) {
      return {
        ok: false,
        message: "Invalid Hive kind.",
        diagnosticReason: "invalid_kind",
      };
    }
    kind = record.kind.trim().toLowerCase() as "own" | "client";
  }

  if (nameError || descriptionError) {
    return {
      ok: false,
      message: nameError ?? descriptionError ?? "Invalid Hive input.",
      nameError,
      descriptionError,
      diagnosticReason: nameError ? "invalid_name" : "invalid_description",
    };
  }

  return {
    ok: true,
    value: {
      name: trimmedName,
      description: trimmedDescription.length > 0 ? trimmedDescription : null,
      clientRequestId,
      kind,
    },
  };
}
