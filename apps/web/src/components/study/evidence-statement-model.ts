import type {
  CanonicalStudy,
  CoverageGap,
  FindingsOpenItem,
  FindingsTopic,
  StudyView,
  StudyViewRow,
  StudyViewSources,
} from "@hiveforyou/contracts";

import type { CitationContext } from "@/components/study/citation-context";
import { type ReadProblem } from "@/components/study/ReadProblemNotice";
import { type ChipRef } from "@/components/study/SourceChip";

export type EvidenceStatementStatus = "checked" | "uncertain" | "unreadable";

export type EvidencePageButton = {
  readonly chip: ChipRef;
  readonly label: string;
  readonly pageNumber: number;
  readonly current: boolean;
};

export type EvidenceStatementModel = {
  readonly headline: string;
  readonly status: EvidenceStatementStatus;
  readonly whyItMatters: string | null;
  readonly pageSupports: string | null;
  readonly documentsDontSay: string | null;
  readonly pageButtons: readonly EvidencePageButton[];
  readonly conflictRow: StudyViewRow | null;
  readonly spineRow: StudyViewRow | null;
  readonly gapText: string | null;
  readonly openItem: FindingsOpenItem | null;
  readonly askClientQuestion: string | null;
};

function blockRows(view: StudyView, name: string): readonly StudyViewRow[] {
  return view.blocks.find((block) => block.name === name)?.rows ?? [];
}

function resolveOpenItemContext(
  item: FindingsOpenItem,
  view: StudyView,
  canonicalStudy: CanonicalStudy | null,
): { conflict?: StudyViewRow; spine?: StudyViewRow; gapText?: string } {
  if (item.id.startsWith("conflict-")) {
    const id = item.id.slice("conflict-".length);
    return { conflict: blockRows(view, "conflicts").find((row) => row.id === id) };
  }
  if (item.id.startsWith("spine-")) {
    const id = item.id.slice("spine-".length);
    return { spine: blockRows(view, "spine_table").find((row) => row.id === id) };
  }
  if (item.id.startsWith("gap-") && canonicalStudy) {
    const id = item.id.slice("gap-".length);
    const gap = canonicalStudy.gaps.find((entry) => entry.id === id);
    return { gapText: gap?.statement?.trim() || gap?.why?.trim() || undefined };
  }
  return {};
}

function isUnreadablePage(
  readProblems: readonly ReadProblem[],
  sourceDocumentId: string,
  pageNumber: number,
): boolean {
  const key = sourceDocumentId.toLowerCase();
  for (const problem of readProblems) {
    if (problem.sourceDocumentId.toLowerCase() !== key) continue;
    if (problem.wholeDocument) return true;
    if (problem.pageNumbers.includes(pageNumber)) return true;
  }
  return false;
}

function factUncertain(
  topics: readonly FindingsTopic[] | undefined,
  factIds: readonly string[] | undefined,
): boolean {
  if (!topics || !factIds?.length) return false;
  const ids = new Set(factIds);
  for (const topic of topics) {
    if (!topic.uncertain) continue;
    for (const statement of topic.statements) {
      if (statement.values.some((value) => ids.has(value.factId))) return true;
    }
  }
  return false;
}

function hasPageVerification(
  chip: ChipRef,
  primaryContext: CitationContext | undefined,
  sources: StudyViewSources | null,
): boolean {
  if (primaryContext) return true;
  for (const factId of chip.factIds ?? []) {
    if (sources?.facts[factId]) return true;
  }
  return false;
}

function gapTextForFacts(
  canonicalStudy: CanonicalStudy | null,
  coverageGaps: readonly CoverageGap[] | undefined,
  factIds: readonly string[] | undefined,
): string | null {
  if (!factIds?.length) return null;
  const fromStudy =
    canonicalStudy?.gaps
      .map((gap) => gap.why?.trim() || gap.statement?.trim() || "")
      .filter(Boolean)
      .join(" ") ?? "";
  if (fromStudy) return fromStudy;
  const fromCoverage =
    coverageGaps
      ?.map((gap) => gap.reason)
      .filter(Boolean)
      .join(" · ") ?? "";
  return fromCoverage || null;
}

function collectPageButtons(
  chip: ChipRef,
  item: FindingsOpenItem | null,
  sources: StudyViewSources | null,
  topics: readonly FindingsTopic[] | undefined,
  chipLabelFor: (id: string) => string,
): EvidencePageButton[] {
  const keys = new Set<string>();
  const buttons: EvidencePageButton[] = [];
  const add = (next: ChipRef) => {
    const key = `${next.sourceDocumentId}:${next.pageNumber}`;
    if (keys.has(key)) return;
    keys.add(key);
    buttons.push({
      chip: next,
      label: next.shortLabel?.trim() || chipLabelFor(next.sourceDocumentId),
      pageNumber: next.pageNumber,
      current: next.sourceDocumentId === chip.sourceDocumentId && next.pageNumber === chip.pageNumber,
    });
  };
  add(chip);
  if (item) {
    for (const factId of item.factIds) {
      const ref = sources?.facts[factId];
      if (!ref) continue;
      add({ sourceDocumentId: ref.sourceDocumentId, pageNumber: ref.pageNumber, quote: ref.quote, factIds: [factId] });
    }
    return buttons;
  }
  for (const topic of topics ?? []) {
    for (const statement of topic.statements) {
      for (const value of statement.values) {
        const ref = sources?.facts[value.factId];
        if (!ref) continue;
        if (ref.sourceDocumentId !== chip.sourceDocumentId) continue;
        add({
          sourceDocumentId: ref.sourceDocumentId,
          pageNumber: ref.pageNumber,
          quote: ref.quote,
          factIds: [value.factId],
        });
      }
    }
  }
  return buttons;
}

export function buildEvidenceStatementModel(input: {
  chip: ChipRef;
  itemId: string | null;
  primaryContext: CitationContext | undefined;
  view: StudyView | null;
  sources: StudyViewSources | null;
  canonicalStudy: CanonicalStudy | null;
  openItems: readonly FindingsOpenItem[] | undefined;
  topics: readonly FindingsTopic[] | undefined;
  coverageGaps: readonly CoverageGap[] | undefined;
  readProblems: readonly ReadProblem[];
  chipLabelFor: (id: string) => string;
}): EvidenceStatementModel {
  const openItem = input.itemId
    ? (input.openItems ?? []).find((entry) => entry.id === input.itemId) ?? null
    : null;
  const extra = openItem && input.view ? resolveOpenItemContext(openItem, input.view, input.canonicalStudy) : {};
  const factIds = input.chip.factIds ?? (input.primaryContext ? [input.primaryContext.factId] : []);
  const unreadable = isUnreadablePage(input.readProblems, input.chip.sourceDocumentId, input.chip.pageNumber);
  const uncertainFromTopics = !unreadable && factUncertain(input.topics, factIds);
  const verifiedOnPage = hasPageVerification(input.chip, input.primaryContext, input.sources);
  const status: EvidenceStatementStatus = unreadable
    ? "unreadable"
    : uncertainFromTopics || !verifiedOnPage
      ? "uncertain"
      : "checked";
  const headline = openItem?.title.trim() || input.primaryContext?.supportingText?.trim() || input.chip.quote?.trim() || "Statement";
  const whyItMatters = openItem?.question?.trim() || null;
  const pageSupports = input.primaryContext?.valueAsWritten?.trim()
    ? `${input.primaryContext.supportingText.trim()}\n${input.primaryContext.valueAsWritten.trim()}`
    : input.primaryContext?.supportingText?.trim() || input.chip.quote?.trim() || null;
  const documentsDontSay = gapTextForFacts(input.canonicalStudy, input.coverageGaps, factIds);
  const askClientQuestion =
    openItem && (openItem.question.trim() || openItem.kind === "needs")
      ? openItem.question.trim() || `Could you tell me more about this: ${openItem.title}?`
      : null;
  return {
    headline,
    status,
    whyItMatters,
    pageSupports,
    documentsDontSay,
    pageButtons: collectPageButtons(input.chip, openItem, input.sources, input.topics, input.chipLabelFor),
    conflictRow: extra.conflict ?? null,
    spineRow: extra.spine ?? null,
    gapText: extra.gapText ?? null,
    openItem,
    askClientQuestion,
  };
}