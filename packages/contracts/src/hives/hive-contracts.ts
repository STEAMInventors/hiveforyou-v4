export const HIVE_NAME_MAX_LENGTH = 100;
export const HIVE_DESCRIPTION_MAX_LENGTH = 500;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Hive = {
  id: string;
  hiveId: string;
  name: string;
  description: string | null;
  clientRequestId: string;
  createdAt: string;
  updatedAt: string;
};

export type ListHivesResponse = {
  hives: Hive[];
};

export type GetHiveResponse = {
  hive: Hive;
};

export type CreateHiveRequest = {
  name: string;
  description?: string | null;
  clientRequestId: string;
};

export type CreateHiveResponse = {
  hive: Hive;
  created: boolean;
};

export type ValidatedCreateHiveInput = {
  name: string;
  description: string | null;
  clientRequestId: string;
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

  return {
    id,
    hiveId,
    name,
    description,
    clientRequestId,
    createdAt,
    updatedAt,
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
    },
  };
}
