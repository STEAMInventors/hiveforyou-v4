export type StateSentenceInput = {
  documentsIn: number;
  /** Checklist size. Null when the hive has no checklist. */
  checklistSize: number | null;
  toReview: number;
  stillToCome: number;
  lastWrote?: { name: string; when: string } | null;
};

export type StateSentenceParts = {
  lead: string;
  trailing: string | null;
};

function documentsClause(documentsIn: number, checklistSize: number | null): string | null {
  if (checklistSize != null && checklistSize > 0) {
    return `${documentsIn} of ${checklistSize} documents are in.`;
  }
  if (documentsIn > 0) {
    return documentsIn === 1 ? "1 document is in." : `${documentsIn} documents are in.`;
  }
  return null;
}

function waitingClause(toReview: number, stillToCome: number): string | null {
  const review =
    toReview > 0
      ? toReview === 1
        ? "1 thing to review"
        : `${toReview} things to review`
      : null;
  const records =
    stillToCome > 0
      ? stillToCome === 1
        ? "1 record is still to come"
        : `${stillToCome} records are still to come`
      : null;
  if (review && records) return `${review}, and ${records}.`;
  if (review) return `${review}.`;
  if (records) return `${records}.`;
  return null;
}

/** One sentence for Home. Zero parts are left out. */
export function buildStateSentence(input: StateSentenceInput): StateSentenceParts {
  const documents = documentsClause(input.documentsIn, input.checklistSize);
  const waiting = waitingClause(input.toReview, input.stillToCome);
  const lead = [documents, waiting].filter(Boolean).join(" ") || "Nothing is waiting on you.";
  const trailing = input.lastWrote ? `${input.lastWrote.name} last wrote ${input.lastWrote.when}.` : null;
  return { lead, trailing };
}
