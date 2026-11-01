import type { ErrorCategory, ErrorSeverity, PipelineStage } from "./enums.js";

export type ApiError = {
  code: string;
  category: ErrorCategory;
  message: string;
  stage?: PipelineStage | undefined;
  retryable: boolean;
  severity: ErrorSeverity;
  correlationId: string;
};

export const TRUST_BOUNDARY_CATEGORIES = [
  "AUTHORIZATION_ERROR",
  "POLICY_ERROR",
  "PACK_VALIDATION_ERROR",
  "PACK_COMPATIBILITY_ERROR",
  "MEASUREMENT_COMPATIBILITY_ERROR",
  "CANONICALIZATION_ERROR",
  "MODEL_OUTPUT_ERROR",
  "EXPORT_ERROR",
] as const;
