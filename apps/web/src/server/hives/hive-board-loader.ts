import {
  buildHiveBoard,
  buildHiveBoardChecklistFromRequests,
  conflictRowsFromStudy,
  normalizeListRequestsResponse,
  parseGapUploadLinks,
  type Hive,
  type HiveBoardModel,
  type HiveBoardStoredEvent,
  type RequestItem,
} from "@hiveforyou/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readModalCopy } from "@/components/hives/document-read-progress";
import { hiveDocumentsPath, hiveReportsPath, hiveStudyPath } from "@/lib/hive-routes";
import { listDocumentReads } from "@/server/source-documents/document-reads";
import {
  createLiveHiveVaultUploadAdapterDeps,
  listHiveSourceDocumentsWithV3Vault,
} from "@/server/source-documents/hive-vault-upload-adapter";

import { VaultAdminConfigError } from "@/server/source-documents/v3-vault/persistence/vault-admin-config-error";

import { loadHiveOverview, type HiveOverview } from "./hive-summary";

/** Document-list failures on read-only pages (e.g. missing vault admin). Auth failures rethrow. */
export function isRecoverableHiveBoardDocumentListFailure(error: unknown): boolean {
  if (error instanceof VaultAdminConfigError) return true;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const record = error as { errorCode?: unknown; category?: unknown };
    if (record.errorCode === "NOT_FOUND" || record.errorCode === "ACCESS_DENIED") return false;
    if (record.category === "SECURITY") return false;
  }
  return true;
}

export type HiveBoardUpload = {
  sourceDocumentId: string;
  fileName: string;
  createdAt: string;
  canonicalGapId: string | null;
  canonicalGapTitle: string | null;
};

export type HiveBoardLoad = {
  overview: HiveOverview;
  board: HiveBoardModel;
  uploads: readonly HiveBoardUpload[];
  /** Persisted Pro requests; empty when none exist or they cannot be loaded. */
  requests: readonly RequestItem[];
};

type IntentRow = {
  id: string;
  intent_text: string;
  created_at: string;
};

function documentsNotInStudyCount(overview: HiveOverview): number {
  const stale = overview.preparation.staleness;
  if (!stale?.stale) return 0;
  return stale.reasons.filter((reason) => reason.kind === "DOCUMENT_ADDED").length;
}

function unreadableFileNames(
  overview: HiveOverview,
  documents: readonly { fileName: string; readStatus: string }[],
): readonly { readonly fileName: string }[] {
  const excluded = overview.preparation.eligibility.excluded
    .filter((item) => item.reason === "UNREADABLE" || item.reason === "READ_FAILED")
    .map((item) => item.fileName);
  const fromList = documents
    .filter((doc) => doc.readStatus === "UNREADABLE" || doc.readStatus === "FAILED")
    .map((doc) => doc.fileName);
  return [...new Set([...excluded, ...fromList])].map((fileName) => ({ fileName }));
}

function buildStoredEvents(input: {
  documents: readonly { fileName: string; registeredAt: string | null; createdAt: string; readStatus: string }[];
  documentReads: readonly { sourceDocumentId: string; status: string; finishedAt: string | null }[];
  documentNameById: Map<string, string>;
  overview: HiveOverview;
  intents: readonly IntentRow[];
}): HiveBoardStoredEvent[] {
  const events: HiveBoardStoredEvent[] = [];

  for (const document of input.documents) {
    const addedAt = document.registeredAt ?? document.createdAt;
    if (addedAt) {
      events.push({ kind: "document_added", at: addedAt, fileName: document.fileName });
    }
  }

  for (const read of input.documentReads) {
    if (!read.finishedAt) continue;
    const fileName = input.documentNameById.get(read.sourceDocumentId.toLowerCase());
    if (!fileName) continue;
    if (read.status === "UNREADABLE") {
      events.push({ kind: "document_unreadable", at: read.finishedAt, fileName });
    } else if (read.status === "SUCCEEDED" || read.status === "PARTIAL") {
      events.push({ kind: "document_read", at: read.finishedAt, fileName });
    }
  }

  const revision = input.overview.preparation.studyRevision;
  if (revision?.createdAt) {
    events.push({ kind: "study_built", at: revision.createdAt, revisionNumber: revision.revisionNumber });
  }

  for (const intent of input.intents) {
    events.push({ kind: "intent_saved", at: intent.created_at, intentText: intent.intent_text });
  }

  for (const run of input.overview.preparation.reportRuns) {
    if (run.status !== "SUCCEEDED" || !run.finishedAt) continue;
    events.push({ kind: "report_written", at: run.finishedAt, audience: run.audience });
  }

  return events;
}

type HiveBoardListedDocument = Awaited<
  ReturnType<typeof listHiveSourceDocumentsWithV3Vault>
>["sourceDocuments"][number];

type HiveBoardDocumentListResult =
  | { readonly status: "listed"; readonly documents: readonly HiveBoardListedDocument[] }
  | { readonly status: "unavailable" };

async function resolveHiveBoardDocumentList(
  client: SupabaseClient,
  input: { hive: Hive; correlationId: string; userId: string },
  options: { recoverListingFailure: boolean },
): Promise<HiveBoardDocumentListResult> {
  const deps = createLiveHiveVaultUploadAdapterDeps(client, input.correlationId);
  try {
    const listed = await listHiveSourceDocumentsWithV3Vault(deps, {
      ownerUserId: input.userId,
      hiveId: input.hive.id,
      correlationId: input.correlationId,
    });
    return { status: "listed", documents: listed.sourceDocuments };
  } catch (error) {
    if (!options.recoverListingFailure || !isRecoverableHiveBoardDocumentListFailure(error)) throw error;
    return { status: "unavailable" };
  }
}

async function assembleHiveBoardLoad(
  client: SupabaseClient,
  input: { hive: Hive; correlationId: string; userId: string },
  documentList: HiveBoardDocumentListResult,
): Promise<HiveBoardLoad> {
  const sourceDocumentListUnavailable = documentList.status === "unavailable";
  const documents = documentList.status === "listed" ? documentList.documents : [];
  const gapUploads = sourceDocumentListUnavailable ? [] : parseGapUploadLinks(documents);

  const overview = await loadHiveOverview(client, {
    hiveId: input.hive.id,
    correlationId: input.correlationId,
    includePreview: false,
    gapUploads,
  });

  let intents: IntentRow[] = [];
  const { data: intentRows } = await client
    .schema("hive")
    .from("intent_requests")
    .select("id,intent_text,created_at")
    .eq("hive_id", input.hive.id)
    .order("created_at", { ascending: false });
  if (Array.isArray(intentRows)) {
    intents = intentRows.filter(
      (row): row is IntentRow =>
        !!row &&
        typeof row === "object" &&
        typeof (row as IntentRow).id === "string" &&
        typeof (row as IntentRow).intent_text === "string" &&
        typeof (row as IntentRow).created_at === "string",
    );
  }

  let readingInProgress =
    overview.preparation.eligibility.activeReadCount > 0 ||
    overview.preparation.eligibility.excluded.some((item) => item.reason === "NOT_READ");
  let readingProgressText: string | null = null;
  let documentReads: Awaited<ReturnType<typeof listDocumentReads>>["documentReads"] = [];

  try {
    const reads = await listDocumentReads(client, { hiveId: input.hive.id, correlationId: input.correlationId });
    documentReads = reads.documentReads;
    readingInProgress = reads.documentReads.some((read) =>
      ["QUEUED", "READING", "SAVING", "VERIFYING"].includes(read.status),
    );
    if (readingInProgress) {
      readingProgressText = readModalCopy(reads.documentReads).sub;
    }
  } catch {
    // preparation eligibility is enough when reads are unavailable
  }

  const conflictRows =
    overview.canonicalStudy && overview.studyTab?.view && overview.studyTab.sources
      ? conflictRowsFromStudy(
          overview.canonicalStudy,
          overview.studyTab.view.blocks.find((block) => block.name === "conflicts")?.rows ?? [],
          overview.studyTab.sources,
        )
      : [];

  const documentNameById = new Map(
    documents.map((document) => [document.sourceDocumentId.toLowerCase(), document.fileName]),
  );

  const latestSucceeded = [...overview.preparation.reportRuns]
    .filter((run) => run.status === "SUCCEEDED" && run.finishedAt)
    .sort((left, right) => Date.parse(right.finishedAt!) - Date.parse(left.finishedAt!))[0];

  let board = buildHiveBoard(
    {
      hiveName: input.hive.name,
      hiveKind: input.hive.kind,
      documentsPath: hiveDocumentsPath(input.hive.id),
      studyPath: hiveStudyPath(input.hive.id),
      reportsPath: hiveReportsPath(input.hive.id),
      documentCount:
        overview.preparation.eligibility.documents.length + overview.preparation.eligibility.excluded.length,
      documentsReadCount: overview.preparation.eligibility.documents.length,
      documentsNotInStudyCount: documentsNotInStudyCount(overview),
      readingInProgress,
      readingProgressText,
      unreadableDocuments: unreadableFileNames(overview, documents),
      canonicalStudy: overview.canonicalStudy,
      referencedDocuments: overview.referencedDocuments,
      gapUploads,
      acceptedStudyRevisionId: overview.preparation.studyRevision?.id ?? null,
      acceptedStudyRevisionAcceptedAt: overview.preparation.studyRevision?.createdAt ?? null,
      conflictRows,
      studyRevisionNumber: overview.preparation.studyRevision?.revisionNumber ?? null,
      hasSucceededReport: overview.preparation.reportRuns.some((run) => run.status === "SUCCEEDED"),
      latestReportAudience: latestSucceeded?.audience ?? null,
      latestReportFinishedAt: latestSucceeded?.finishedAt ?? null,
      sourceDocumentListUnavailable,
      storedEvents: buildStoredEvents({
        documents,
        documentReads,
        documentNameById,
        overview,
        intents,
      }),
    },
    new Date(),
  );

  let requests: readonly RequestItem[] = [];
  try {
    const { data: requestData } = await client.rpc("list_requests", { p_hive_id: input.hive.id });
    const listed = normalizeListRequestsResponse(requestData);
    if (listed && listed.requests.length > 0) {
      requests = listed.requests;
      const fromRequests = buildHiveBoardChecklistFromRequests(listed.requests, hiveDocumentsPath(input.hive.id));
      board = {
        ...board,
        checklist: fromRequests.checklist,
        progress: fromRequests.progress,
        checklistNote: fromRequests.checklistNote,
      };
    }
  } catch {
    // Study-derived checklist remains when requests cannot be loaded.
  }

  return {
    overview,
    board,
    uploads: sourceDocumentListUnavailable
      ? []
      : documents.map((document) => ({
          sourceDocumentId: document.sourceDocumentId,
          fileName: document.fileName,
          createdAt: document.createdAt,
          canonicalGapId: document.canonicalGapId ?? null,
          canonicalGapTitle: document.canonicalGapTitle ?? null,
        })),
    requests,
  };
}

export async function loadHiveBoard(
  client: SupabaseClient,
  input: { hive: Hive; correlationId: string; userId: string },
): Promise<HiveBoardLoad> {
  const documentList = await resolveHiveBoardDocumentList(client, input, { recoverListingFailure: false });
  return assembleHiveBoardLoad(client, input, documentList);
}

/** Loads the board when vault listing works; keeps study, report and checklist data when listing alone fails. */
export async function loadHiveBoardResilient(
  client: SupabaseClient,
  input: { hive: Hive; correlationId: string; userId: string },
): Promise<HiveBoardLoad> {
  const documentList = await resolveHiveBoardDocumentList(client, input, { recoverListingFailure: true });
  return assembleHiveBoardLoad(client, input, documentList);
}