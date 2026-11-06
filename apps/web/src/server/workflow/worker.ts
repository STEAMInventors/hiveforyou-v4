import { createHiveError } from "@hiveforyou/contracts";
import { loadSupabaseAdminEnv } from "@hives/persistence/env";
import { createSupabaseAdminClient } from "@hives/persistence/storage/supabase-client";

import { processDocumentRead } from "@/server/source-documents/document-reads";
import { loadReaderServiceConfig } from "@/server/source-documents/read-document";
import { loadPlannerServiceConfig } from "@/server/study-preparation/planner-client";

import { type AnalysisWorkflowDeps, processAnalysisRun } from "./analysis-workflow";
import { createWorkflowDispatch, loadInternalWorkerToken, type WorkItem } from "./dispatch";
import { processReportRun } from "./report-generation";

/** Owner routes refuse to queue work that could never be handed off between invocations. */
export function requireWorkerDispatch(env: NodeJS.ProcessEnv, correlationId: string): void {
  if (loadInternalWorkerToken(env)) return;
  throw createHiveError({
    errorCode: "MODEL_UNAVAILABLE",
    category: "DEPENDENCY",
    stage: "ANALYZE",
    retryable: true,
    safeMessage: "Analysis is temporarily unavailable. Please try again later.",
    correlationId,
    diagnosticReason: "dispatch_unconfigured",
  });
}

/** Service-role dependencies for one invocation. Configuration is read lazily, when a stage needs it. */
export function createWorkerDeps(
  env: NodeJS.ProcessEnv,
  input: { origin: string; correlationId: string; invocationStartedAt?: number },
): AnalysisWorkflowDeps {
  const deps: AnalysisWorkflowDeps = {
    client: createSupabaseAdminClient(loadSupabaseAdminEnv(env)),
    planner: { getConfig: () => loadPlannerServiceConfig(env, input.correlationId) },
    reader: { getReaderConfig: () => loadReaderServiceConfig(env, input.correlationId) },
    dispatch: createWorkflowDispatch({
      token: loadInternalWorkerToken(env),
      origin: input.origin,
      fallback: (item): Promise<void> => runWorkItem(deps, item),
    }),
    ...(input.invocationStartedAt !== undefined ? { invocationStartedAt: input.invocationStartedAt } : {}),
  };
  return deps;
}

/** Runs one dispatched work item. Never throws, so it is safe inside `after()`. */
export async function runWorkItem(deps: AnalysisWorkflowDeps, item: WorkItem): Promise<void> {
  try {
    if (item.kind === "analysis") await processAnalysisRun(deps, item.id);
    else if (item.kind === "report") await processReportRun(deps, item.id);
    else await processDocumentRead({ client: deps.client, reader: deps.reader }, item.id);
  } catch {
    // The lease lapses; a later owner action or a duplicate dispatch may claim the work again.
  }
}
