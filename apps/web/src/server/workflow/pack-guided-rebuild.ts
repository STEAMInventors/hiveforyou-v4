/**
 * One selected Rebuild through the pack-guided engine.
 * The same steps serve every published Domain Pack. A failure does not publish a Study.
 */
import {
  createHiveError,
  type CanonicalStudy,
  type DocExtraction,
  type HiveError,
  type ProcessingRun,
  type StageMetric,
} from "@hiveforyou/contracts";
import { computeSha256Digest } from "@hiveforyou/contracts/document-read";
import {
  PACK_GUIDED_CANONICALIZE_PROMPT_ID,
  PACK_GUIDED_STUDY_ENGINE_ID,
  compileDomainPack,
  compileEffectiveDomainPack,
  compileInvestigationPrompt,
  constructPackGuidedStudy,
  resolveSyntheticExecutionFixtureId,
  specifyCaseInvestigation,
  verifyExtractionEvidence,
  type FrozenCasePage,
} from "@hiveforyou/contracts/study-engine";

import { emitStructuredEvent } from "@/server/observability/logger";
import { runPackGuidedCanonicalize } from "@/server/pipeline/pack-guided-canonicalize";
import type { PlannerDeps } from "@/server/study-preparation/planner-client";

import { resolvePublishedDomainPack, type LoadedPublishedPack } from "./domain-pack-selection";

export type PackGuidedRebuildResult =
  | { ok: true; study: CanonicalStudy; metric: StageMetric }
  | { ok: false; error: HiveError; metric: null };

type AuthorizedPages = { documentId: string; pages: { pageNumber: number; text: string }[] };

function preserved(input: {
  correlationId: string;
  runId: string;
  hiveId: string;
  code: string;
  effectivePackDigest: string;
  evidenceDigest: string;
  safeMessage: string;
  errorCode?: HiveError["errorCode"];
}): HiveError {
  const error = createHiveError({
    errorCode: input.errorCode ?? "MODEL_OUTPUT_INVALID",
    category: "VALIDATION",
    stage: "ANALYZE",
    retryable: false,
    safeMessage: input.safeMessage,
    correlationId: input.correlationId,
    operationId: input.runId,
    diagnosticReason: input.code === "privacy_denied" || input.code === "evidence_snapshot_mismatch" || input.code === "prompt_rejected" || input.code === "prompt_capacity"
      ? input.code
      : "pack_guided_study_preserved",
    diagnosticField: input.code,
  });
  emitStructuredEvent({
    eventName: "pipeline.pack_guided.study_preserved",
    severity: "ERROR",
    timestamp: new Date().toISOString(),
    component: "pipeline",
    operation: "pack_guided_study",
    stage: "CANONICALIZING",
    correlationId: input.correlationId,
    hiveId: input.hiveId,
    processingRunId: input.runId,
    status: "PRESERVED",
    errorCode: error.errorCode,
    retryable: false,
    diagnosticReason: error.diagnosticReason,
    diagnosticField: input.code,
    errorDetail: `engine=${PACK_GUIDED_STUDY_ENGINE_ID};pack=${input.effectivePackDigest};evidence=${input.evidenceDigest};status=PRESERVED;code=${input.code}`,
  });
  return error;
}

function stopped(input: {
  correlationId: string;
  runId: string;
  hiveId: string;
  code: string;
  safeMessage: string;
  errorCode?: HiveError["errorCode"];
  retryable?: boolean;
}): HiveError {
  return preserved({
    ...input,
    effectivePackDigest: "",
    evidenceDigest: "",
    errorCode: input.errorCode ?? "INVALID_REQUEST",
  });
}

export async function runPackGuidedStudy(input: {
  planner: PlannerDeps;
  run: ProcessingRun;
  extractions: readonly DocExtraction[];
  pages: readonly AuthorizedPages[];
  requestText: string;
  correlationId: string;
  stageAttempt: number;
  now: () => Date;
  packsCwd?: string;
  resolvePlannerTimeoutMs?: () => number | "expired";
  publishedPack?: LoadedPublishedPack | null;
}): Promise<PackGuidedRebuildResult> {
  const { run, correlationId } = input;
  const published = input.publishedPack === undefined
    ? resolvePublishedDomainPack(
        {
          intentText: input.requestText,
          documents: input.extractions.flatMap((extraction) => [
            extraction.fileName,
            extraction.document?.documentType,
            extraction.document?.titleAsPrinted,
            extraction.document?.summary,
            extraction.document?.domain?.label,
          ]).filter((value): value is string => typeof value === "string" && value.trim() !== ""),
        },
        input.packsCwd,
      )
    : input.publishedPack
      ? { status: "selected" as const, pack: input.publishedPack }
      : { status: "none" as const };
  if (published.status === "invalid") {
    return {
      ok: false,
      metric: null,
      error: stopped({
        correlationId,
        runId: run.id,
        hiveId: run.hiveId,
        code: "pack_guided_engine_failed",
        safeMessage: "The study pack could not be loaded. Your earlier study is unchanged.",
      }),
    };
  }
  if (published.status !== "selected") {
    return {
      ok: false,
      metric: null,
      error: stopped({
        correlationId,
        runId: run.id,
        hiveId: run.hiveId,
        code: "pack_guided_engine_failed",
        safeMessage: "No published study pack applies to this hive. Your earlier study is unchanged.",
      }),
    };
  }
  const compiled = compileDomainPack(published.pack.source);
  if (!compiled.ok) {
    return {
      ok: false,
      metric: null,
      error: stopped({
        correlationId,
        runId: run.id,
        hiveId: run.hiveId,
        code: "pack_guided_engine_failed",
        safeMessage: "The study pack could not be compiled. Your earlier study is unchanged.",
      }),
    };
  }
  const effective = compileEffectiveDomainPack({ base: compiled.value });
  if (!effective.ok) {
    return {
      ok: false,
      metric: null,
      error: stopped({
        correlationId,
        runId: run.id,
        hiveId: run.hiveId,
        code: "pack_guided_engine_failed",
        safeMessage: "The study pack could not be compiled. Your earlier study is unchanged.",
      }),
    };
  }
  const specification = specifyCaseInvestigation({
    pack: effective.value,
    hiveId: run.hiveId,
    attributes: [],
  });
  if (!specification.ok) {
    return {
      ok: false,
      metric: null,
      error: stopped({
        correlationId,
        runId: run.id,
        hiveId: run.hiveId,
        code: "pack_guided_engine_failed",
        safeMessage: "The case could not be prepared for analysis. Your earlier study is unchanged.",
      }),
    };
  }
  const frozen: FrozenCasePage[] = input.pages.flatMap((document) =>
    document.pages.map((page) => ({
      documentId: document.documentId,
      pageNumber: page.pageNumber,
      text: page.text,
      sourcePageDigest: computeSha256Digest(page.text),
    })),
  );
  const evidence = verifyExtractionEvidence({ extractions: input.extractions, pages: frozen });
  if (!evidence.ok) {
    return {
      ok: false,
      metric: null,
      error: preserved({
        correlationId,
        runId: run.id,
        hiveId: run.hiveId,
        code: "evidence_snapshot_mismatch",
        effectivePackDigest: effective.value.digest,
        evidenceDigest: "",
        safeMessage: "The saved evidence does not match the frozen pages. Your earlier study is unchanged.",
        errorCode: "INVALID_REQUEST",
      }),
    };
  }
  const fixtureId = resolveSyntheticExecutionFixtureId({ hiveId: run.hiveId, pages: frozen });
  if (!fixtureId) {
    return {
      ok: false,
      metric: null,
      error: preserved({
        correlationId,
        runId: run.id,
        hiveId: run.hiveId,
        code: "privacy_denied",
        effectivePackDigest: effective.value.digest,
        evidenceDigest: evidence.value.index.digest,
        safeMessage: "This case cannot be sent to the model. Your earlier study is unchanged.",
        errorCode: "ACCESS_DENIED",
      }),
    };
  }
  const preview = compileInvestigationPrompt({
    pack: effective.value,
    specification: specification.value,
    evidence: evidence.value,
    intent: input.requestText,
    disclosure: { decision: "AUTHORIZED", basis: "SYNTHETIC_FIXTURE" },
    factValues: [],
    authorizedPages: frozen.map((page) => ({
      documentId: page.documentId,
      pageNumber: page.pageNumber,
      sourcePageDigest: page.sourcePageDigest,
    })),
  });
  if (!preview.ok) {
    return {
      ok: false,
      metric: null,
      error: preserved({
        correlationId,
        runId: run.id,
        hiveId: run.hiveId,
        code: preview.capacity ? "prompt_capacity" : "prompt_rejected",
        effectivePackDigest: effective.value.digest,
        evidenceDigest: evidence.value.index.digest,
        safeMessage: preview.capacity
          ? "The case is larger than the analysis limit. Nothing was dropped. Your earlier study is unchanged."
          : "The case could not be prepared for analysis. Your earlier study is unchanged.",
        errorCode: "MODEL_OUTPUT_INVALID",
      }),
    };
  }
  const startedAt = input.now().toISOString();
  const guided = await runPackGuidedCanonicalize({
    planner: input.planner,
    correlationId,
    runId: run.id,
    fixtureId,
    pack: effective.value,
    specification: specification.value,
    evidence: evidence.value,
    pages: frozen,
    extractions: input.extractions,
    intent: input.requestText,
    resolvePlannerTimeoutMs: input.resolvePlannerTimeoutMs,
  });
  if (!guided.ok) {
    return {
      ok: false,
      metric: null,
      error: preserved({
        correlationId,
        runId: run.id,
        hiveId: run.hiveId,
        code: guided.error.diagnosticReason ?? "pack_guided_engine_failed",
        effectivePackDigest: effective.value.digest,
        evidenceDigest: evidence.value.index.digest,
        safeMessage: `${guided.error.safeMessage} Your earlier study is unchanged.`.replace(
          "Your earlier study is unchanged. Your earlier study is unchanged.",
          "Your earlier study is unchanged.",
        ),
        errorCode: guided.error.errorCode,
      }),
    };
  }
  const constructed = constructPackGuidedStudy({
    resolution: guided.resolution,
    pack: effective.value,
    specification: specification.value,
    extractions: input.extractions,
    pages: input.pages,
    questionObligationIds: guided.questionObligationIds,
    evidenceDigest: evidence.value.index.digest,
    existingStudy: null,
    studyDate: input.now().toISOString().slice(0, 10),
    relationshipStructures: published.pack.relationshipStructures,
  });
  if (!constructed.ok || !constructed.study || constructed.outcome !== "ACCEPTED" || constructed.validation.outcome !== "ACCEPTED") {
    return {
      ok: false,
      metric: null,
      error: preserved({
        correlationId,
        runId: run.id,
        hiveId: run.hiveId,
        code: constructed.code,
        effectivePackDigest: constructed.effectivePackDigest || effective.value.digest,
        evidenceDigest: constructed.evidenceDigest || evidence.value.index.digest,
        safeMessage: "The study did not pass validation, so it was not accepted. Your earlier study is unchanged.",
      }),
    };
  }
  const identity = published.pack.source.identity;
  const study: CanonicalStudy = {
    ...constructed.study,
    questionOrder: [
      ...(constructed.study.questionOrder ?? []),
      `pack-id:${identity.packId}`,
      `pack-version:${identity.version}`,
      `pack-digest:${constructed.effectivePackDigest}`,
      `evidence-digest:${constructed.evidenceDigest}`,
    ],
  };
  const last = guided.calls.at(-1);
  const metric: StageMetric = {
    stage: "CANONICALIZING",
    attempt: input.stageAttempt,
    outcome: "SUCCEEDED",
    promptId: PACK_GUIDED_CANONICALIZE_PROMPT_ID,
    promptDigest: guided.promptDigest,
    modelAliasRequested: last?.resolvedModel ?? null,
    resolvedModel: last?.resolvedModel ?? null,
    promptTokens: guided.calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
    completionTokens: guided.calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
    totalTokens: guided.calls.reduce((sum, call) => sum + (call.inputTokens ?? 0) + (call.outputTokens ?? 0), 0),
    latencyMs: guided.calls.reduce((sum, call) => sum + (call.latencyMs ?? 0), 0),
    finishReason: last?.finishReason ?? null,
    startedAt,
    completedAt: input.now().toISOString(),
  };
  emitStructuredEvent({
    eventName: "pipeline.pack_guided.study_accepted",
    severity: "INFO",
    timestamp: input.now().toISOString(),
    component: "pipeline",
    operation: "pack_guided_study",
    stage: "CANONICALIZING",
    correlationId,
    hiveId: run.hiveId,
    processingRunId: run.id,
    status: "ACCEPTED",
    diagnosticReason: "pack_guided_study_accepted",
    diagnosticField: "ACCEPTED",
    errorDetail: `engine=${PACK_GUIDED_STUDY_ENGINE_ID};pack=${constructed.effectivePackDigest};evidence=${constructed.evidenceDigest};status=ACCEPTED;code=ACCEPTED`,
  });
  return { ok: true, study, metric };
}
