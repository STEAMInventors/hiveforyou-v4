import {
  TRUST_BOUNDARY_CATEGORIES,
  type ApiError,
  type CaseId,
  type CorrelationId,
  type ErrorCategory,
  type ErrorSeverity,
  type EvidenceSetId,
  type PackId,
  type PipelineStage,
  type RunId,
} from "@hives/contracts";

export type HiveErrorInput = {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly message: string;
  readonly stage?: PipelineStage | undefined;
  readonly retryable: boolean;
  readonly severity: ErrorSeverity;
  readonly correlationId: CorrelationId;
  readonly caseId?: CaseId | undefined;
  readonly runId?: RunId | undefined;
  readonly evidenceSetId?: EvidenceSetId | undefined;
  readonly packId?: PackId | undefined;
  readonly packVersion?: string | undefined;
  readonly cause?: unknown;
  readonly safeContext?: Readonly<Record<string, string | number | boolean | null>> | undefined;
};

export class HiveError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly stage?: PipelineStage | undefined;
  readonly retryable: boolean;
  readonly severity: ErrorSeverity;
  readonly correlationId: CorrelationId;
  readonly caseId?: CaseId | undefined;
  readonly runId?: RunId | undefined;
  readonly evidenceSetId?: EvidenceSetId | undefined;
  readonly packId?: PackId | undefined;
  readonly packVersion?: string | undefined;
  override readonly cause?: unknown;
  readonly safeContext?: Readonly<Record<string, string | number | boolean | null>> | undefined;

  constructor(input: HiveErrorInput) {
    super(input.message);
    this.name = "HiveError";
    this.code = input.code;
    this.category = input.category;
    this.stage = input.stage;
    this.retryable = input.retryable;
    this.severity = input.severity;
    this.correlationId = input.correlationId;
    this.caseId = input.caseId;
    this.runId = input.runId;
    this.evidenceSetId = input.evidenceSetId;
    this.packId = input.packId;
    this.packVersion = input.packVersion;
    this.cause = input.cause;
    this.safeContext = input.safeContext;
  }

  isTrustBoundary(): boolean {
    return (TRUST_BOUNDARY_CATEGORIES as readonly string[]).includes(this.category);
  }
}

const SENSITIVE_KEY = /content|snippet|prompt|response|document|ssn|email|name|address/i;
const ALWAYS_SAFE_CONTEXT_KEYS = new Set([
  "documentAlias",
  "extractRef",
  "proposalId",
  "violationDirection",
]);

export function toApiError(error: HiveError): ApiError {
  const api: ApiError = {
    code: error.code,
    category: error.category,
    message: error.message,
    retryable: error.retryable,
    severity: error.severity,
    correlationId: error.correlationId,
  };
  if (error.stage !== undefined) {
    return { ...api, stage: error.stage };
  }
  return api;
}

export function failClosed(error: HiveError): never {
  throw error;
}

export function isHiveError(value: unknown): value is HiveError {
  return value instanceof HiveError;
}

export function sanitizeSafeContext(
  context: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, string | number | boolean | null>> | undefined {
  if (context === undefined) {
    return undefined;
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!ALWAYS_SAFE_CONTEXT_KEYS.has(key) && SENSITIVE_KEY.test(key)) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (value === null) {
      out[key] = null;
    }
  }
  return out;
}
