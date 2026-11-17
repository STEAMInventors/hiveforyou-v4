import { ACTIVE_DOCUMENT_READ_STATUSES, type Hive } from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listDocumentReads } from "@/server/source-documents/document-reads";

export type HivePollSnapshot = {
  version: string;
  fastPoll: boolean;
};

const FAST_POLL_STATUSES = new Set<string>([...ACTIVE_DOCUMENT_READ_STATUSES, "RECEIVED"]);

export async function loadHivePollSnapshot(
  client: SupabaseClient,
  hive: Hive,
  correlationId: string,
): Promise<HivePollSnapshot> {
  let documentReadsUpdated = hive.updatedAt;
  let fastPoll = false;

  try {
    const reads = await listDocumentReads(client, { hiveId: hive.id, correlationId });
    for (const row of reads.documentReads) {
      if (typeof row.updatedAt === "string" && row.updatedAt > documentReadsUpdated) {
        documentReadsUpdated = row.updatedAt;
      }
      if (FAST_POLL_STATUSES.has(row.status)) {
        fastPoll = true;
      }
    }
  } catch {
    // Poll still works with hive timestamp only.
  }

  const version = [hive.updatedAt, documentReadsUpdated, fastPoll ? "1" : "0"].join("|");
  return { version, fastPoll };
}