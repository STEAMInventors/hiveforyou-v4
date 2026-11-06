import type { StudyView, StudyViewSources } from "@hiveforyou/contracts";

export type CitationContext = {
  /** Sentence or row statement (or conflict row statement). */
  readonly supportingText: string;
  /** Value as written for the cited fact, when known. */
  readonly valueAsWritten: string | null;
  /** Verified quote from the fact record. */
  readonly verifiedQuote: string;
  readonly factId: string;
};

export type SiblingPageTarget = {
  readonly pageNumber: number;
  readonly label: string;
};

function chipKey(sourceDocumentId: string, pageNumber: number): string {
  return `${sourceDocumentId}:${pageNumber}`;
}

function valueAsWrittenForFact(view: StudyView, factId: string): string | null {
  for (const block of view.blocks) {
    for (const row of block.rows) {
      for (const v of row.values) {
        if (v.factId === factId) return v.valueAsWritten.trim();
      }
    }
  }
  return null;
}

function siblingPagesFromValues(
  values: readonly { readonly factId: string; readonly sourceRef: { readonly sourceDocumentId: string; readonly pageNumber: number } }[],
  currentDocId: string,
  currentPage: number,
  sources: StudyViewSources,
): SiblingPageTarget[] {
  const seen = new Set<number>();
  const out: SiblingPageTarget[] = [];
  for (const v of values) {
    const ref = sources.facts[v.factId];
    if (!ref || ref.sourceDocumentId !== currentDocId) continue;
    if (ref.pageNumber === currentPage) continue;
    if (seen.has(ref.pageNumber)) continue;
    seen.add(ref.pageNumber);
    out.push({ pageNumber: ref.pageNumber, label: `Page ${ref.pageNumber}` });
  }
  return out;
}

/**
 * Per (document, page), citation context for "What this supports" and sibling page jumps.
 */
export function buildCitationContextMap(
  view: StudyView,
  sources: StudyViewSources | null,
): ReadonlyMap<string, readonly { context: CitationContext; siblings: readonly SiblingPageTarget[] }[]> {
  const map = new Map<string, { context: CitationContext; siblings: SiblingPageTarget[] }[]>();

  const add = (
    sourceDocumentId: string,
    pageNumber: number,
    context: CitationContext,
    siblings: readonly SiblingPageTarget[],
  ) => {
    const key = chipKey(sourceDocumentId, pageNumber);
    const list = map.get(key) ?? [];
    list.push({ context, siblings: [...siblings] });
    map.set(key, list);
  };

  if (!sources) return map;

  for (const section of view.sections) {
    for (const paragraph of section.paragraphs) {
      for (const sentence of paragraph.sentences) {
        const refsInSentence = sentence.factIds
          .map((id) => ({ factId: id, ref: sources.facts[id] }))
          .filter((x): x is { factId: string; ref: NonNullable<(typeof sources.facts)[string]> } => !!x.ref);
        for (const { factId, ref } of refsInSentence) {
          const siblings = siblingPagesFromValues(
            refsInSentence.map((r) => ({ factId: r.factId, sourceRef: r.ref })),
            ref.sourceDocumentId,
            ref.pageNumber,
            sources,
          );
          add(ref.sourceDocumentId, ref.pageNumber, {
            supportingText: sentence.text,
            valueAsWritten: valueAsWrittenForFact(view, factId),
            verifiedQuote: ref.quote,
            factId,
          }, siblings);
        }
      }
    }
  }

  const spine = view.blocks.find((b) => b.name === "spine_table")?.rows ?? [];
  const outside = view.blocks.find((b) => b.name === "outside_spine")?.rows ?? [];
  for (const row of [...spine, ...outside]) {
    for (const v of row.values) {
      const ref = sources.facts[v.factId];
      if (!ref) continue;
      const siblings = siblingPagesFromValues(row.values, ref.sourceDocumentId, ref.pageNumber, sources);
      const label = row.label?.trim() || row.statement?.trim() || "";
      add(ref.sourceDocumentId, ref.pageNumber, {
        supportingText: label,
        valueAsWritten: v.valueAsWritten.trim(),
        verifiedQuote: ref.quote,
        factId: v.factId,
      }, siblings);
    }
  }

  const timeline = view.blocks.find((b) => b.name === "timeline")?.rows ?? [];
  for (const row of timeline) {
    for (const v of row.values) {
      const ref = sources.facts[v.factId];
      if (!ref) continue;
      const siblings = siblingPagesFromValues(row.values, ref.sourceDocumentId, ref.pageNumber, sources);
      const line = row.statement?.trim() ?? "";
      add(ref.sourceDocumentId, ref.pageNumber, {
        supportingText: line,
        valueAsWritten: v.valueAsWritten.trim(),
        verifiedQuote: ref.quote,
        factId: v.factId,
      }, siblings);
    }
  }

  const conflicts = view.blocks.find((b) => b.name === "conflicts")?.rows ?? [];
  for (const row of conflicts) {
    for (const v of row.values) {
      const ref = sources.facts[v.factId];
      if (!ref) continue;
      const siblings = siblingPagesFromValues(row.values, ref.sourceDocumentId, ref.pageNumber, sources);
      const statement = row.statement?.trim() ?? "";
      add(ref.sourceDocumentId, ref.pageNumber, {
        supportingText: statement,
        valueAsWritten: v.valueAsWritten.trim(),
        verifiedQuote: ref.quote,
        factId: v.factId,
      }, siblings);
    }
  }

  return map;
}
