import {
  type PipelineThroughputStats,
  type PipelineThroughputTask,
  PIPELINE_THROUGHPUT_CACHE_MS,
  defaultPipelineThroughput,
  normalizePipelineThroughput,
} from "@hiveforyou/contracts";

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

const cache = new Map<PipelineThroughputTask, { loadedAt: number; stats: PipelineThroughputStats }>();

export function clearPipelineThroughputCacheForTests(): void {
  cache.clear();
}

export async function loadPipelineThroughput(
  client: RpcClient,
  task: PipelineThroughputTask,
  nowMs: number = Date.now(),
): Promise<PipelineThroughputStats> {
  const safeNowMs = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  const cached = cache.get(task);
  if (cached && safeNowMs - cached.loadedAt < PIPELINE_THROUGHPUT_CACHE_MS) {
    return cached.stats;
  }
  try {
    const result = await client.rpc("get_pipeline_throughput", { p_task: task });
    if (!result || result.error) {
      return defaultPipelineThroughput(task);
    }
    const stats = normalizePipelineThroughput(task, result.data);
    cache.set(task, { loadedAt: safeNowMs, stats });
    return stats;
  } catch {
    return defaultPipelineThroughput(task);
  }
}

export async function recordPipelineModelCall(
  client: RpcClient,
  input: {
    runId: string;
    task: PipelineThroughputTask;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    concurrencyAtStart: number;
    pageRange?: string | null;
    pageCount?: number | null;
  },
): Promise<void> {
  const { error } = await client.rpc("record_pipeline_model_call", {
    p_run_id: input.runId,
    p_task: input.task,
    p_payload: {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      latencyMs: input.latencyMs,
      concurrencyAtStart: input.concurrencyAtStart,
      ...(input.pageRange ? { pageRange: input.pageRange } : {}),
      ...(input.pageCount ? { pageCount: input.pageCount } : {}),
    },
  });
  if (error) throw new Error(error.message ?? "record_pipeline_model_call failed");
}
