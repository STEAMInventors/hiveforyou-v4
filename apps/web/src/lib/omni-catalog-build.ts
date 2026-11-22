import type {
  AuditTrailEntry,
  FindingsOpenItem,
  FindingsTopic,
  HiveBoardChecklistItem,
  LegacyHomeOpenItem,
  LegacyHomeTopic,
  SourceDocument,
  StudyViewRow,
  StudyViewSources,
} from "@hiveforyou/contracts";

import type { ChipRef } from "@/components/study/SourceChip";
import type { HiveWorkspaceDocument } from "@/components/study/hive-evidence-model";
import {
  EMPTY_OMNI_CATALOG,
  type OmniCatalog,
  type OmniDocumentHit,
  type OmniOpenItem,
  type OmniStatement,
} from "@/lib/omni-catalog-model";

function chipFromFact(factId: string, sources: StudyViewSources | null): ChipRef | null {
  const ref = sources?.facts[factId];
  if (!ref) return null;
  return {
    sourceDocumentId: ref.sourceDocumentId,
    pageNumber: ref.pageNumber,
    quote: ref.quote,
    factIds: [factId],
  };
}

function chipsForOpenItem(item: FindingsOpenItem, sources: StudyViewSources | null): ChipRef | null {
  for (const factId of item.factIds) {
    const chip = chipFromFact(factId, sources);
    if (chip) return chip;
  }
  return null;
}

export function omniStatementsFromTopics(topics: readonly FindingsTopic[]): OmniStatement[] {
  const out: OmniStatement[] = [];
  for (const topic of topics) {
    for (const statement of topic.statements ?? []) {
      const value = statement.values?.[0];
      const ref = value?.sourceRef
        ? {
            sourceDocumentId: value.sourceRef.sourceDocumentId,
            pageNumber: value.sourceRef.pageNumber,
            quote: value.sourceRef.quote,
            factIds: [value.factId],
          }
        : null;
      out.push({
        id: statement.id,
        text: statement.text,
        topic: topic.title,
        pageLabel: ref ? `p.${ref.pageNumber}` : "",
        ref,
      });
    }
  }
  return out;
}

export function omniOpenItemsFromFindings(
  items: readonly FindingsOpenItem[],
  sources: StudyViewSources | null,
): OmniOpenItem[] {
  return items.map((item) => {
    const kind: OmniOpenItem["kind"] =
      item.kind === "needs" ? "needs" : item.kind === "difference" ? "changed" : "missing";
    return {
      id: item.id,
      title: item.title,
      kind,
      detail: item.question?.trim() || undefined,
      ref: chipsForOpenItem(item, sources),
    };
  });
}

export function omniOpenItemsFromChecklist(checklist: readonly HiveBoardChecklistItem[]): OmniOpenItem[] {
  return checklist
    .filter((row) => row.status === "not_in" || row.status === "added_pending")
    .map((row) => ({
      id: row.gapId,
      title: row.title.trim(),
      kind: row.status === "added_pending" ? ("changed" as const) : ("missing" as const),
      detail: row.statusText?.trim() || undefined,
      ref: null,
    }));
}

export function omniStatementsFromAudit(entries: readonly AuditTrailEntry[]): OmniStatement[] {
  return entries.map((entry) => {
    const chip = entry.chips[0];
    const ref: ChipRef | null = chip
      ? {
          sourceDocumentId: chip.sourceDocumentId,
          pageNumber: chip.pageNumber,
          quote: chip.quote,
          factIds: "factIds" in chip && chip.factIds ? [...chip.factIds] : [],
        }
      : null;
    return {
      id: entry.id,
      text: entry.title,
      topic: "Checks",
      pageLabel: ref ? `p.${ref.pageNumber}` : "",
      ref,
    };
  });
}

export function omniStatementFromEvidence(input: {
  id: string;
  text: string;
  topic: string;
  chip: ChipRef;
}): OmniStatement {
  return {
    id: input.id,
    text: input.text,
    topic: input.topic,
    pageLabel: `p.${input.chip.pageNumber}`,
    ref: input.chip,
  };
}

function isGenericDocumentLabel(label: string | null | undefined): boolean {
  const normalized = (label ?? "").trim().toLowerCase();
  return normalized === "" || normalized === "document" || normalized === "not read yet";
}

function humanizeFileName(fileName: string | null | undefined): string {
  const trimmed = (fileName ?? "").trim();
  if (!trimmed) return "Document";
  return trimmed.replace(/\.[^./\\]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || trimmed;
}

export function omniStatementsFromLegacyHomeTopics(topics: readonly LegacyHomeTopic[]): OmniStatement[] {
  const out: OmniStatement[] = [];
  for (const topic of topics) {
    for (const statement of topic.statements) {
      const first = statement.refs[0];
      const ref: ChipRef | null = first
        ? {
            sourceDocumentId: first.sourceDocumentId,
            pageNumber: first.pageNumber,
            quote: first.quote,
            factIds: [first.factId],
          }
        : null;
      out.push({
        id: statement.id,
        text: statement.text,
        topic: topic.title,
        pageLabel: ref ? `p.${ref.pageNumber}` : "",
        ref,
      });
    }
  }
  return out;
}

export function omniOpenItemsFromLegacyHome(items: readonly LegacyHomeOpenItem[]): OmniOpenItem[] {
  return items.map((item) => {
    const first = item.refs[0];
    const ref: ChipRef | null = first
      ? {
          sourceDocumentId: first.sourceDocumentId,
          pageNumber: first.pageNumber,
          quote: first.quote,
          factIds: [first.factId],
        }
      : null;
    return {
      id: item.id,
      title: item.title,
      kind: "needs",
      detail: item.detail || undefined,
      ref,
    };
  });
}

export function omniStatementsFromTimeline(rows: readonly StudyViewRow[]): OmniStatement[] {
  const out: OmniStatement[] = [];
  for (const row of rows) {
    const text = row.statement?.trim() ?? "";
    if (!text) continue;
    const first = row.values[0];
    const ref: ChipRef | null = first
      ? {
          sourceDocumentId: first.sourceRef.sourceDocumentId,
          pageNumber: first.sourceRef.pageNumber,
          quote: first.sourceRef.quote,
          factIds: [first.factId],
        }
      : null;
    out.push({
      id: row.id,
      text,
      topic: row.date?.trim() ? `Timeline · ${row.date.trim()}` : "Timeline",
      pageLabel: ref ? `p.${ref.pageNumber}` : "",
      ref,
    });
  }
  return out;
}

export function omniDocumentsFromLibraryRows(
  rows: readonly {
    sourceDocumentId: string;
    fileName?: string;
    titleLine: string;
    typeLine: string | null;
    periodLabel: string;
    pageCount: number | null;
  }[],
): OmniDocumentHit[] {
  return rows.map((row) => {
    const fileName = row.fileName?.trim() || undefined;
    const role = isGenericDocumentLabel(row.titleLine) && fileName ? humanizeFileName(fileName) : row.titleLine;
    return {
      id: row.sourceDocumentId,
      role,
      typeLabel: row.typeLine?.trim() || "Document",
      period: row.periodLabel === "—" ? "" : row.periodLabel,
      pages: row.pageCount ?? 0,
      ref: { sourceDocumentId: row.sourceDocumentId, pageNumber: 1 },
      fileName,
    };
  });
}

export function omniDocumentsFromStudyRows(
  rows: readonly StudyViewRow[],
  pageCountFor: (id: string) => number | undefined,
  fileNameFor?: (id: string) => string | undefined,
): OmniDocumentHit[] {
  return rows.map((row) => {
    const fileName = fileNameFor?.(row.id) ?? fileNameFor?.(row.id.toLowerCase());
    const roleCandidate = row.typeInPlainWords?.trim() || row.label?.trim() || "";
    return {
      id: row.id,
      role: isGenericDocumentLabel(roleCandidate) && fileName ? humanizeFileName(fileName) : roleCandidate || "Document",
      typeLabel: row.status?.trim() || "Document",
      period: row.date?.trim() ?? "",
      pages: pageCountFor(row.id) ?? pageCountFor(row.id.toLowerCase()) ?? 0,
      ref: { sourceDocumentId: row.id, pageNumber: 1 },
      fileName,
    };
  });
}

export function omniDocumentsFromSourceList(
  documents: readonly SourceDocument[],
  roleFor: (id: string) => string,
  pagesFor: (id: string) => number,
): OmniDocumentHit[] {
  return documents.map((document) => {
    const rawRole = roleFor(document.sourceDocumentId);
    const fileName = document.fileName?.trim() || undefined;
    return {
      id: document.sourceDocumentId,
      role: isGenericDocumentLabel(rawRole) && fileName ? humanizeFileName(fileName) : rawRole,
      typeLabel: "Uploaded",
      period: "",
      pages: pagesFor(document.sourceDocumentId),
      ref: { sourceDocumentId: document.sourceDocumentId, pageNumber: 1 },
      fileName,
    };
  });
}

/**
 * Builds authorized document search hits from workspace documents and optional StudyView document rows.
 * Only indexes documents already authorized for the current Hive; preserves both plain role and fileName.
 */
export function omniDocumentsFromWorkspace(input: {
  readonly workspaceDocuments?: readonly HiveWorkspaceDocument[];
  readonly studyDocumentRows?: readonly StudyViewRow[];
  readonly documentPages?: Readonly<Record<string, number>>;
  readonly sourcesDocuments?: StudyViewSources["documents"];
}): OmniDocumentHit[] {
  const byId = new Map<string, OmniDocumentHit>();
  const studyById = new Map<string, StudyViewRow>();
  for (const row of input.studyDocumentRows ?? []) {
    studyById.set(row.id.toLowerCase(), row);
  }
  const sourcesById = new Map<string, { readonly fileName?: string; readonly typeInPlainWords?: string | null }>();
  if (input.sourcesDocuments) {
    for (const [id, entry] of Object.entries(input.sourcesDocuments)) {
      sourcesById.set(id.toLowerCase(), entry);
    }
  }
  const pagesFor = (id: string): number =>
    input.documentPages?.[id] ?? input.documentPages?.[id.toLowerCase()] ?? 0;

  for (const doc of input.workspaceDocuments ?? []) {
    const key = doc.sourceDocumentId.toLowerCase();
    const studyRow = studyById.get(key);
    const sourceEntry = sourcesById.get(key);
    const fileName = doc.fileName?.trim() || sourceEntry?.fileName?.trim() || undefined;
    const plainType =
      studyRow?.typeInPlainWords?.trim() ||
      doc.typeInPlainWords?.trim() ||
      sourceEntry?.typeInPlainWords?.trim() ||
      "";
    const role = !isGenericDocumentLabel(plainType)
      ? plainType
      : fileName
        ? humanizeFileName(fileName)
        : "Document";
    byId.set(key, {
      id: doc.sourceDocumentId,
      role,
      typeLabel: studyRow?.status?.trim() || (plainType ? "Document" : "Uploaded"),
      period: studyRow?.date?.trim() ?? "",
      pages: pagesFor(doc.sourceDocumentId),
      ref: { sourceDocumentId: doc.sourceDocumentId, pageNumber: 1 },
      fileName,
    });
  }

  for (const row of input.studyDocumentRows ?? []) {
    const key = row.id.toLowerCase();
    if (byId.has(key)) continue;
    const sourceEntry = sourcesById.get(key);
    const fileName = sourceEntry?.fileName?.trim() || undefined;
    const roleCandidate = row.typeInPlainWords?.trim() || row.label?.trim() || "";
    byId.set(key, {
      id: row.id,
      role: !isGenericDocumentLabel(roleCandidate)
        ? roleCandidate
        : fileName
          ? humanizeFileName(fileName)
          : "Document",
      typeLabel: row.status?.trim() || "Document",
      period: row.date?.trim() ?? "",
      pages: pagesFor(row.id),
      ref: { sourceDocumentId: row.id, pageNumber: 1 },
      fileName,
    });
  }

  return [...byId.values()];
}

export function mergeOmniCatalog(
  base: Omit<OmniCatalog, "suggestions"> & { suggestions?: readonly string[] },
): OmniCatalog {
  return {
    suggestions: base.suggestions ?? EMPTY_OMNI_CATALOG.suggestions,
    statements: base.statements ?? EMPTY_OMNI_CATALOG.statements,
    openItems: base.openItems ?? EMPTY_OMNI_CATALOG.openItems,
    documents: base.documents ?? EMPTY_OMNI_CATALOG.documents,
  };
}