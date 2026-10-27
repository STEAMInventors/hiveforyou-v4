"use client";

import type {
  CreateHiveRequest,
  CreateHiveResponse,
  GetHiveResponse,
  ListHivesResponse,
  PublicErrorBody,
} from "@hiveforyou/contracts";

const CORRELATION_HEADER = "x-correlation-id";

function isPublicErrorBody(value: unknown): value is PublicErrorBody {
  if (!value || typeof value !== "object") {
    return false;
  }
  const error = (value as { error?: unknown }).error;
  return (
    Boolean(error) &&
    typeof error === "object" &&
    typeof (error as { errorCode?: unknown }).errorCode === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

export class HiveClientError extends Error {
  readonly errorCode: string;
  readonly retryable: boolean;
  readonly correlationId: string;
  readonly status: number;

  constructor(input: {
    message: string;
    errorCode: string;
    retryable: boolean;
    correlationId: string;
    status: number;
  }) {
    super(input.message);
    this.name = "HiveClientError";
    this.errorCode = input.errorCode;
    this.retryable = input.retryable;
    this.correlationId = input.correlationId;
    this.status = input.status;
  }
}

async function parseApiJson<T>(
  response: Response,
  fallbackCorrelationId: string,
  fallbackMessage: string,
): Promise<T> {
  const correlationId =
    response.headers.get(CORRELATION_HEADER) ?? fallbackCorrelationId;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || isPublicErrorBody(body)) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent("/hives")}`;
    }
    if (isPublicErrorBody(body)) {
      throw new HiveClientError({
        message: body.error.message,
        errorCode: body.error.errorCode,
        retryable: body.error.retryable,
        correlationId: body.error.correlationId || correlationId,
        status: response.status,
      });
    }
    throw new HiveClientError({
      message: fallbackMessage,
      errorCode: "PERSISTENCE_FAILED",
      retryable: true,
      correlationId,
      status: response.status,
    });
  }

  return body as T;
}

export async function fetchMyHives(): Promise<ListHivesResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch("/api/v1/hives", {
    headers: { [CORRELATION_HEADER]: correlationId },
    credentials: "same-origin",
  });
  return parseApiJson<ListHivesResponse>(
    response,
    correlationId,
    "Could not load your Hives.",
  );
}

export async function fetchHive(hiveId: string): Promise<GetHiveResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(
    `/api/v1/hives/${encodeURIComponent(hiveId)}`,
    {
      headers: { [CORRELATION_HEADER]: correlationId },
      credentials: "same-origin",
    },
  );
  return parseApiJson<GetHiveResponse>(
    response,
    correlationId,
    "We could not find that Hive.",
  );
}

export async function createHive(
  payload: CreateHiveRequest,
): Promise<CreateHiveResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch("/api/v1/hives", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [CORRELATION_HEADER]: correlationId,
    },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  return parseApiJson<CreateHiveResponse>(
    response,
    correlationId,
    "Could not create your Hive. Please try again.",
  );
}
