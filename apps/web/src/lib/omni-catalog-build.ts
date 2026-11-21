import type {
  AuditTrailEntry,
  FindingsOpenItem,
  FindingsTopic,
  HiveBoardChecklistItem,
  SourceDocument,
  StudyViewRow,
  StudyViewSources,
} from "@hiveforyou/contracts";

import type { ChipRef } from "@/components/study/SourceChip";
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
    for (const statement of topic.statements) {
      const value = statement.values[0];
      const ref = value
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

export function omniDocumentsFromLibraryRows(
  rows: readonly {
    sourceDocumentId: string;
    titleLine: string;
    typeLine: string | null;
    periodLabel: string;
    pageCount: number | null;
  }[],
): OmniDocumentHit[] {
  return rows.map((row) => ({
    id: row.sourceDocumentId,
    role: row.titleLine,
    typeLabel: row.typeLine?.trim() || "Document",
    period: row.periodLabel === "—" ? "" : row.periodLabel,
    pages: row.pageCount ?? 0,
    ref: { sourceDocumentId: row.sourceDocumentId, pageNumber: 1 },
  }));
}

export function omniDocumentsFromStudyRows(
  rows: readonly StudyViewRow[],
  pageCountFor: (id: string) => number | undefined,
): OmniDocumentHit[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.typeInPlainWords?.trim() || row.label?.trim() || "Document",
    typeLabel: row.status?.trim() || "Document",
    period: row.date?.trim() ?? "",
    pages: pageCountFor(row.id) ?? pageCountFor(row.id.toLowerCase()) ?? 0,
    ref: { sourceDocumentId: row.id, pageNumber: 1 },
  }));
}

export function omniDocumentsFromSourceList(
  documents: readonly SourceDocument[],
  roleFor: (id: string) => string,
  pagesFor: (id: string) => number,
): OmniDocumentHit[] {
  return documents.map((document) => ({
    id: document.sourceDocumentId,
    role: roleFor(document.sourceDocumentId),
    typeLabel: "Uploaded",
    period: "",
    pages: pagesFor(document.sourceDocumentId),
    ref: { sourceDocumentId: document.sourceDocumentId, pageNumber: 1 },
  }));
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