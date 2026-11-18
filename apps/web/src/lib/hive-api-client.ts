import type { PublicErrorBody } from "@hiveforyou/contracts";

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

export const CORRELATION_HEADER_NAME = CORRELATION_HEADER;

export async function parseApiJson<T>(
  response: Response,
  fallbackCorrelationId: string,
  fallbackMessage: string,
): Promise<T> {
  const correlationId = response.headers.get(CORRELATION_HEADER) ?? fallbackCorrelationId;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || isPublicErrorBody(body)) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.href = `/sign-in?next=${encodeURIComponent("/hives")}`;
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