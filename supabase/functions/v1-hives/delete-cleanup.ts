import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

import {
  HIVE_SOURCE_DOCUMENTS_BUCKET,
  listStorageObjectPaths,
  mergeUniquePaths,
  removeStorageObjects,
  verifyStoragePrefixEmpty,
} from "../_shared/hive-source-storage.ts";
import { jsonResponse, logEdgeEvent } from "../_shared/http.ts";

type EdgeUserSupabaseClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

const DB_TIMEOUT_MS = 8000;
const STORAGE_TIMEOUT_MS = 30000;

type BeginDeletionPayload = {
  hive_id?: string;
  owner_user_id?: string;
  storage_prefix?: string;
  storage_paths?: unknown;
};

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("misconfigured");
  }
  return createClient(url, serviceKey);
}

export async function deleteHiveWithCleanup(
  supabase: EdgeUserSupabaseClient,
  correlationId: string,
  hiveId: string,
): Promise<Response> {
  const { data: beginRaw, error: beginError } = await withTimeout(
    supabase.rpc("begin_hive_deletion", { p_hive_id: hiveId }),
    DB_TIMEOUT_MS,
  );
  if (beginError) {
    throw beginError;
  }
  const begin = beginRaw as BeginDeletionPayload;
  const storagePrefix =
    typeof begin.storage_prefix === "string" ? begin.storage_prefix.trim() : "";
  const dbPaths = parseStringArray(begin.storage_paths);
  if (!storagePrefix) {
    throw new Error("begin_without_prefix");
  }

  logEdgeEvent({
    eventName: "deleteHive.marked",
    severity: "INFO",
    operation: "deleteHive",
    stage: "SHELL",
    correlationId,
    hiveId,
    status: "SUCCEEDED",
    diagnosticReason: "deletion_marked",
  });

  const admin = createServiceClient();
  let listedPaths: string[] = [];
  try {
    listedPaths = await withTimeout(
      listStorageObjectPaths(admin, HIVE_SOURCE_DOCUMENTS_BUCKET, storagePrefix),
      STORAGE_TIMEOUT_MS,
    );
  } catch (storageError) {
    const message = storageError instanceof Error ? storageError.message : String(storageError);
    logEdgeEvent({
      eventName: "deleteHive.failed",
      severity: "ERROR",
      operation: "deleteHive",
      stage: "SHELL",
      correlationId,
      hiveId,
      status: "FAILED",
      errorCode: "PERSISTENCE_FAILED",
      retryable: true,
      diagnosticReason: message.slice(0, 200),
    });
    throw storageError;
  }

  const pathsToRemove = mergeUniquePaths(dbPaths, listedPaths);
  if (pathsToRemove.length > 0) {
    try {
      await withTimeout(
        removeStorageObjects(admin, HIVE_SOURCE_DOCUMENTS_BUCKET, pathsToRemove),
        STORAGE_TIMEOUT_MS,
      );
    } catch (storageError) {
      const message = storageError instanceof Error ? storageError.message : String(storageError);
      logEdgeEvent({
        eventName: "deleteHive.failed",
        severity: "ERROR",
        operation: "deleteHive",
        stage: "SHELL",
        correlationId,
        hiveId,
        status: "FAILED",
        errorCode: "PERSISTENCE_FAILED",
        retryable: true,
        diagnosticReason: message.slice(0, 200),
      });
      throw storageError;
    }
  }

  const empty = await withTimeout(
    verifyStoragePrefixEmpty(admin, HIVE_SOURCE_DOCUMENTS_BUCKET, storagePrefix),
    STORAGE_TIMEOUT_MS,
  );
  if (!empty) {
    logEdgeEvent({
      eventName: "deleteHive.failed",
      severity: "ERROR",
      operation: "deleteHive",
      stage: "SHELL",
      correlationId,
      hiveId,
      status: "FAILED",
      errorCode: "PERSISTENCE_FAILED",
      retryable: true,
      diagnosticReason: "storage_cleanup_incomplete",
    });
    throw new Error("storage_cleanup_incomplete");
  }

  const { data: completeRaw, error: completeError } = await withTimeout(
    admin.rpc("complete_hive_deletion", { p_hive_id: hiveId }),
    DB_TIMEOUT_MS,
  );
  if (completeError) {
    throw completeError;
  }
  const complete = completeRaw as { deleted?: boolean } | null;
  if (!complete?.deleted) {
    throw new Error("db_finalize_failed");
  }

  logEdgeEvent({
    eventName: "deleteHive.completed",
    severity: "INFO",
    operation: "deleteHive",
    stage: "SHELL",
    correlationId,
    hiveId,
    status: "SUCCEEDED",
    diagnosticReason: "deletion_completed",
  });

  return jsonResponse({ deleted: true }, 200, correlationId);
}
