import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudyRevisionLines } from "@hiveforyou/contracts";

type RevisionRow = {
  id: string;
  revision_number: number;
  created_at: string;
  predecessor_revision_id: string | null;
  processing_run_id: string;
  authorized_source_document_ids: string[] | null;
};

type RunRow = {
  id: string;
  source_snapshot: { authorizedSourceDocumentIds?: string[] } | null;
};

export async function loadStudyRevisionHistory(
  client: SupabaseClient,
  hiveId: string,
): Promise<ReturnType<typeof buildStudyRevisionLines>> {
  const { data: revisionRows, error } = await client
    .schema("hive")
    .from("study_revisions")
    .select("id,revision_number,created_at,predecessor_revision_id,processing_run_id,authorized_source_document_ids")
    .eq("hive_id", hiveId)
    .order("revision_number", { ascending: true });

  if (error || !Array.isArray(revisionRows) || revisionRows.length === 0) {
    return [];
  }

  const rows = revisionRows as RevisionRow[];
  const runIds = [...new Set(rows.map((row) => row.processing_run_id))];
  const { data: runRows } = await client
    .schema("hive")
    .from("processing_runs")
    .select("id,source_snapshot")
    .in("id", runIds);

  const snapshotByRun = new Map<string, string[]>();
  if (Array.isArray(runRows)) {
    for (const run of runRows as RunRow[]) {
      const ids =
        run.source_snapshot?.authorizedSourceDocumentIds ??
        [];
      snapshotByRun.set(run.id.toLowerCase(), ids.map((id) => id.toLowerCase()));
    }
  }

  const predecessorSource = new Map<number, string[]>();
  for (const row of rows) {
    const ids =
      row.authorized_source_document_ids?.map((id) => id.toLowerCase()) ??
      snapshotByRun.get(row.processing_run_id.toLowerCase()) ??
      [];
    predecessorSource.set(row.revision_number, ids);
  }

  return buildStudyRevisionLines(
    rows.map((row) => {
      const predecessor =
        row.predecessor_revision_id != null
          ? rows.find((entry) => entry.id === row.predecessor_revision_id)
          : null;
      return {
        revisionNumber: row.revision_number,
        createdAt: row.created_at,
        sourceDocumentIds: predecessorSource.get(row.revision_number) ?? [],
        predecessorSourceDocumentIds: predecessor
          ? predecessorSource.get(predecessor.revision_number) ?? null
          : null,
      };
    }),
  );
}