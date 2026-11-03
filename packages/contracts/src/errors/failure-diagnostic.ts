/**
 * Safe failure diagnostic (`failure-diagnostic@1`).
 *
 * Oracle, Vercel and the workflow database share this shape. It names the failing layer,
 * operation and reason. It never carries prompts, page text, model output, credentials or URLs.
 * `planner-error@1` stays the planner HTTP envelope; the diagnostic fields on it are additive.
 */

export const FAILURE_DIAGNOSTIC_VERSION = "failure-diagnostic@1" as const;
export const PLANNER_ERROR_CONTRACT_VERSION = "planner-error@1" as const;

export const FAILURE_COMPONENTS = ["reader", "planner", "analysis", "writer", "scenario", "a2ui"] as const;
export type FailureComponent = (typeof FAILURE_COMPONENTS)[number];

const SNAKE = /^[a-z][a-z0-9_]{0,63}$/;
const STAGE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_.:/\[\]@+-]{0,127}$/;
const SAFE_ID = /^[A-Za-z0-9_.:/@+-]{1,128}$/;

export type FailureDiagnostic = {
  contractVersion: typeof FAILURE_DIAGNOSTIC_VERSION;
  component: FailureComponent;
  operation: string;
  task: string | null;
  stage: string;
  errorCode: string;
  diagnosticReason: string;
  diagnosticField: string | null;
  retryable: boolean;
  attempt: number;
};

export type FailureDiagnosticInput = {
  component: FailureComponent;
  operation: string;
  task?: string | null;
  stage: string;
  errorCode: string;
  diagnosticReason: string;
  diagnosticField?: string | null;
  retryable: boolean;
  attempt: number;
};

/** A schema-error path such as `answers[0].status`, when the message starts with one. */
export function diagnosticFieldFromMessage(message: string): string | undefined {
  const match = /^([A-Za-z][A-Za-z0-9_.:/\[\]@+-]{0,127})/.exec(message);
  const field = match?.[1];
  if (!field || (!field.includes(".") && !field.includes("["))) return undefined;
  if (!FIELD.test(field)) return undefined;
  return field;
}

function snake(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  return SNAKE.test(value) ? value : null;
}

function stageName(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !STAGE.test(value)) return null;
  return value;
}

export function buildFailureDiagnostic(input: FailureDiagnosticInput): FailureDiagnostic | null {
  const operation = snake(input.operation);
  const stage = stageName(input.stage);
  const errorCode = typeof input.errorCode === "string" && ERROR_CODE.test(input.errorCode) ? input.errorCode : null;
  const diagnosticReason = snake(input.diagnosticReason);
  const task = input.task == null || input.task === "" ? null : snake(input.task);
  const diagnosticField =
    input.diagnosticField == null || input.diagnosticField === ""
      ? null
      : FIELD.test(input.diagnosticField)
        ? input.diagnosticField
        : null;
  if (
    !operation ||
    !stage ||
    !errorCode ||
    !diagnosticReason ||
    !FAILURE_COMPONENTS.includes(input.component) ||
    !Number.isInteger(input.attempt) ||
    input.attempt < 0 ||
    input.attempt > 99 ||
    (input.task != null && input.task !== "" && task === null)
  ) {
    return null;
  }
  if (input.diagnosticField != null && input.diagnosticField !== "" && diagnosticField === null) {
    return null;
  }
  return {
    contractVersion: FAILURE_DIAGNOSTIC_VERSION,
    component: input.component,
    operation,
    task,
    stage,
    errorCode,
    diagnosticReason,
    diagnosticField,
    retryable: input.retryable,
    attempt: input.attempt,
  };
}

function componentOf(value: unknown): FailureComponent | null {
  return typeof value === "string" && (FAILURE_COMPONENTS as readonly string[]).includes(value)
    ? (value as FailureComponent)
    : null;
}

/** Drops anything outside the safe diagnostic. Returns null when the record is not one. */
export function normalizeFailureDiagnostic(raw: unknown): FailureDiagnostic | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.contractVersion !== FAILURE_DIAGNOSTIC_VERSION) return null;
  const component = componentOf(record.component);
  if (!component) return null;
  const attempt = record.attempt;
  if (typeof record.retryable !== "boolean" || typeof attempt !== "number") return null;
  return buildFailureDiagnostic({
    component,
    operation: String(record.operation ?? ""),
    task: record.task == null ? null : String(record.task),
    stage: String(record.stage ?? ""),
    errorCode: String(record.errorCode ?? ""),
    diagnosticReason: String(record.diagnosticReason ?? ""),
    diagnosticField: record.diagnosticField == null ? null : String(record.diagnosticField),
    retryable: record.retryable,
    attempt,
  });
}

const STAGE_TASK: Record<string, { task: string; operation: string }> = {
  READ: { task: "read", operation: "read_document" },
  READING_DOCUMENTS: { task: "read", operation: "read_documents" },
  UNDERSTANDING_REQUEST: { task: "intent", operation: "analyze_intent" },
  IDENTIFYING_DOMAIN: { task: "domain", operation: "identify_domain" },
  DEVELOPING_QUESTIONS: { task: "intelligence", operation: "develop_questions" },
  PLANNING_INVESTIGATION: { task: "plan", operation: "plan_investigation" },
  BUILDING_PROMPT: { task: "study", operation: "build_prompt" },
  SAVING: { task: "study", operation: "save_preview" },
  INVESTIGATING: { task: "study", operation: "investigate" },
  VERIFYING_EVIDENCE: { task: "study", operation: "verify_study" },
  ACCEPTING_STUDY: { task: "study", operation: "accept_study" },
  WRITING: { task: "writer", operation: "write_report" },
  VALIDATING: { task: "writer", operation: "validate_writer" },
};

/**
 * Picks the failing layer from the stage and the safe reason.
 * Planner and model-gateway reasons stay on `planner` even when the stage is Canonical Study.
 */
export function classifyFailure(input: {
  stage: string;
  diagnosticReason: string;
  task?: string | null;
}): { component: FailureComponent; operation: string; task: string | null } {
  const reason = input.diagnosticReason;
  const mapped = STAGE_TASK[input.stage];
  const task = snake(input.task) ?? mapped?.task ?? null;
  const planner =
    reason.startsWith("litellm_") ||
    reason.startsWith("planner_") ||
    reason.startsWith("model_content_") ||
    reason.startsWith("model_output_") ||
    reason.startsWith("model_response_") ||
    reason === "model_context_exceeded" ||
    reason === "model_alias_unconfigured";
  if (planner) {
    return { component: "planner", operation: input.stage === "INVESTIGATING" ? "study_agent_turn" : "plan_completion", task };
  }
  if (
    reason.startsWith("reader_") ||
    reason.startsWith("page_") ||
    reason === "document_unreadable" ||
    reason === "artifact_hash_mismatch" ||
    reason === "source_object_missing"
  ) {
    return { component: "reader", operation: "read_document", task: "read" };
  }
  if (reason.startsWith("writer_scenario") || reason === "writer_formula_invalid") {
    return { component: "scenario", operation: "calculate_scenarios", task: "writer" };
  }
  if (reason.startsWith("view_")) {
    return { component: "a2ui", operation: "bind_view", task: "writer" };
  }
  if (reason.startsWith("writer_")) {
    return { component: "writer", operation: "validate_writer", task: "writer" };
  }
  if (reason.startsWith("study_agent_")) {
    return { component: "analysis", operation: "investigate", task: "study" };
  }
  if (reason.startsWith("study_") || reason === "quotation_mismatch") {
    return { component: "analysis", operation: "verify_study", task: "study" };
  }
  return {
    component: "analysis",
    operation: mapped?.operation ?? "analyze",
    task,
  };
}

export type PlannerErrorEnvelope = {
  contractVersion: typeof PLANNER_ERROR_CONTRACT_VERSION;
  errorCode: string;
  retryable: boolean;
  correlationId: string | null;
  processingRunId: string | null;
  task: string | null;
  diagnosticReason: string | null;
};

/** Reads `planner-error@1`, including envelopes from before diagnostic fields existed. */
export function normalizePlannerErrorEnvelope(raw: unknown): PlannerErrorEnvelope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.contract_version !== undefined && record.contract_version !== PLANNER_ERROR_CONTRACT_VERSION) {
    return null;
  }
  const errorCode = typeof record.error_code === "string" ? record.error_code.trim().toUpperCase() : "";
  if (!ERROR_CODE.test(errorCode)) return null;
  const correlationId = typeof record.correlation_id === "string" && SAFE_ID.test(record.correlation_id) ? record.correlation_id : null;
  const processingRunId =
    typeof record.processing_run_id === "string" && SAFE_ID.test(record.processing_run_id) ? record.processing_run_id : null;
  const task = typeof record.task === "string" ? snake(record.task) : null;
  const diagnosticReason = typeof record.diagnostic_reason === "string" ? snake(record.diagnostic_reason) : null;
  return {
    contractVersion: PLANNER_ERROR_CONTRACT_VERSION,
    errorCode,
    retryable: typeof record.retryable === "boolean" ? record.retryable : false,
    correlationId,
    processingRunId,
    task,
    diagnosticReason,
  };
}

export const SUPPORT_DIAGNOSTIC_KINDS = ["processing_run", "report_run", "document_read"] as const;
export type SupportDiagnosticKind = (typeof SUPPORT_DIAGNOSTIC_KINDS)[number];

export type SupportDiagnostic = {
  kind: SupportDiagnosticKind;
  operationId: string;
  status: string;
  diagnostic: FailureDiagnostic;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Owner lookup payload. Unknown keys, prompts and model text are dropped. */
export function normalizeSupportDiagnostics(raw: unknown): { correlationId: string; diagnostics: SupportDiagnostic[] } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const correlationId = typeof record.correlationId === "string" ? record.correlationId.toLowerCase() : "";
  if (!UUID.test(correlationId)) return null;
  if (!Array.isArray(record.diagnostics)) return null;
  const diagnostics: SupportDiagnostic[] = [];
  for (const item of record.diagnostics) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const kind = row.kind;
    const operationId = typeof row.operationId === "string" ? row.operationId.toLowerCase() : "";
    const status = typeof row.status === "string" && STAGE.test(row.status) ? row.status : null;
    const diagnostic = normalizeFailureDiagnostic(row.diagnostic);
    if (
      typeof kind !== "string" ||
      !(SUPPORT_DIAGNOSTIC_KINDS as readonly string[]).includes(kind) ||
      !UUID.test(operationId) ||
      !status ||
      !diagnostic
    ) {
      continue;
    }
    diagnostics.push({ kind: kind as SupportDiagnosticKind, operationId, status, diagnostic });
  }
  return { correlationId, diagnostics };
}
