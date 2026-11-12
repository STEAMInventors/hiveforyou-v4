import type { SpineElement } from "./canonical-study-contracts";

const INTERNAL_ID = /^[A-Z][A-Z0-9_]{2,}$/;

/** Prefer spine label over internal goal or element identifiers in rendered values. */
export function displayValueForWrittenText(valueAsWritten: string, subject: string, spine: readonly SpineElement[]): string {
  const trimmed = valueAsWritten.trim();
  if (!INTERNAL_ID.test(trimmed)) return valueAsWritten;
  const byKind = spine.find((element) => element.kind.toUpperCase() === trimmed);
  if (byKind) return byKind.label;
  const subjectKey = subject.trim().toLowerCase();
  const bySubject = spine.find(
    (element) => element.label.toLowerCase().includes(subjectKey) && subjectKey.length > 2,
  );
  if (bySubject && bySubject.label.trim() !== "") return bySubject.label;
  return valueAsWritten;
}
