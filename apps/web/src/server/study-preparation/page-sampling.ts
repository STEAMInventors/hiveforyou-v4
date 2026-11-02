import { createHiveError, type SampleCoverage, type SnapshotDocument } from "@hiveforyou/contracts";

import {
  type DocumentPageRpcClient,
  listDocumentPagesForSource,
} from "@/server/source-documents/document-pages-persistence";

/**
 * Deterministic page sample for `hive-domain/1`. The same frozen pages always produce the same
 * sample: documents in snapshot order, each contributing its first non-empty page, its last
 * non-empty page, then evenly spaced middle pages, taking turns so every document is represented
 * before any document gets a second page.
 */

export const SAMPLE_PER_PAGE_CHARACTER_LIMIT = 2_500;
export const SAMPLE_TOTAL_CHARACTER_BUDGET = 24_000;
export const SAMPLE_MAX_PAGES_PER_DOCUMENT = 4;
const MIN_FIRST_ROUND_CHARACTERS = 400;

export type SamplePage = { readonly pageNumber: number; readonly text: string };
export type SampleDocument = { readonly sourceDocumentId: string; readonly pages: readonly SamplePage[] };

export type DomainSample = {
  readonly sourceDocumentId: string;
  readonly pageNumber: number;
  readonly truncated: boolean;
  readonly untrustedText: string;
};

export type SampleLimits = {
  readonly perPageCharacterLimit: number;
  readonly totalCharacterBudget: number;
  readonly maxPagesPerDocument: number;
};

export const DEFAULT_SAMPLE_LIMITS: SampleLimits = {
  perPageCharacterLimit: SAMPLE_PER_PAGE_CHARACTER_LIMIT,
  totalCharacterBudget: SAMPLE_TOTAL_CHARACTER_BUDGET,
  maxPagesPerDocument: SAMPLE_MAX_PAGES_PER_DOCUMENT,
};

/** Page numbers to sample from one document, in priority order. */
export function samplePageOrder(pages: readonly SamplePage[], maxPages: number): number[] {
  const withContent = pages
    .filter((page) => page.text.trim().length > 0)
    .map((page) => page.pageNumber)
    .sort((a, b) => a - b);
  if (withContent.length === 0 || maxPages < 1) return [];
  const order: number[] = [withContent[0]!];
  const add = (pageNumber: number) => {
    if (!order.includes(pageNumber) && order.length < maxPages) order.push(pageNumber);
  };
  add(withContent[withContent.length - 1]!);
  const interior = maxPages - 2;
  for (let k = 1; k <= interior; k += 1) {
    add(withContent[Math.round((k * (withContent.length - 1)) / (interior + 1))]!);
  }
  return order;
}

function truncate(text: string, limit: number): { text: string; characters: number; truncated: boolean } {
  const characters = Array.from(text.trim());
  return characters.length <= limit
    ? { text: characters.join(""), characters: characters.length, truncated: false }
    : { text: characters.slice(0, limit).join(""), characters: limit, truncated: true };
}

export function selectDomainSamples(
  documents: readonly SampleDocument[],
  limits: SampleLimits = DEFAULT_SAMPLE_LIMITS,
): { samples: DomainSample[]; coverage: SampleCoverage } {
  const queues = documents.map((document) => ({
    document,
    textByPage: new Map(document.pages.map((page) => [page.pageNumber, page.text])),
    order: samplePageOrder(document.pages, limits.maxPagesPerDocument),
    taken: 0,
  }));
  const withContent = queues.filter((queue) => queue.order.length > 0).length;
  const firstRoundLimit = Math.min(
    limits.perPageCharacterLimit,
    Math.max(MIN_FIRST_ROUND_CHARACTERS, Math.floor(limits.totalCharacterBudget / Math.max(withContent, 1))),
  );

  const samples: DomainSample[] = [];
  const coveragePages: SampleCoverage["pages"] = [];
  let used = 0;
  for (let round = 0; round < limits.maxPagesPerDocument; round += 1) {
    for (const queue of queues) {
      const pageNumber = queue.order[round];
      if (pageNumber === undefined) continue;
      const remaining = limits.totalCharacterBudget - used;
      const limit = Math.min(round === 0 ? firstRoundLimit : limits.perPageCharacterLimit, remaining);
      if (limit < MIN_FIRST_ROUND_CHARACTERS) continue;
      const { text, characters, truncated } = truncate(queue.textByPage.get(pageNumber) ?? "", limit);
      used += characters;
      queue.taken += 1;
      samples.push({ sourceDocumentId: queue.document.sourceDocumentId, pageNumber, truncated, untrustedText: text });
      coveragePages.push({
        sourceDocumentId: queue.document.sourceDocumentId,
        pageNumber,
        characters,
        truncated,
      });
    }
  }

  return {
    samples,
    coverage: {
      perPageCharacterLimit: limits.perPageCharacterLimit,
      totalCharacterBudget: limits.totalCharacterBudget,
      sampledCharacterCount: used,
      pages: coveragePages,
      documentsWithoutSample: queues
        .filter((queue) => queue.taken === 0)
        .map((queue) => ({
          sourceDocumentId: queue.document.sourceDocumentId,
          reason: queue.order.length === 0 ? ("NO_CONTENT_PAGE" as const) : ("BUDGET_EXHAUSTED" as const),
        })),
    },
  };
}

/**
 * Loads each frozen document's verified pages from `hive.document_pages`. A page set that no longer
 * matches the frozen fingerprint or digest is a source change, never silently re-read.
 */
export async function loadFrozenSampleDocuments(
  client: DocumentPageRpcClient,
  input: {
    readonly hiveId: string;
    readonly documents: readonly SnapshotDocument[];
    readonly correlationId: string;
  },
): Promise<SampleDocument[]> {
  const loaded: SampleDocument[] = [];
  for (const document of input.documents) {
    const persisted = await listDocumentPagesForSource(client, {
      hiveId: input.hiveId,
      sourceDocumentId: document.sourceDocumentId,
      readFingerprint: document.readFingerprint,
      pageSetDigest: document.pageSetDigest,
      expectedSourceSha256: document.sha256,
      correlationId: input.correlationId,
    });
    if (
      !persisted.found ||
      persisted.readFingerprint !== document.readFingerprint ||
      persisted.pageSetDigest !== document.pageSetDigest.toLowerCase()
    ) {
      throw createHiveError({
        errorCode: "COVERAGE_INCOMPLETE",
        category: "DOCUMENT",
        stage: "ANALYZE",
        retryable: true,
        safeMessage: "Your documents changed while preparing. Analyze again to use the latest versions.",
        correlationId: input.correlationId,
        diagnosticReason: "source_changed",
      });
    }
    loaded.push({
      sourceDocumentId: document.sourceDocumentId.toLowerCase(),
      pages: persisted.pages.map((page) => ({ pageNumber: page.page_number, text: page.page_text })),
    });
  }
  return loaded;
}
