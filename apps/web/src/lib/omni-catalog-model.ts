import type { ChipRef } from "@/components/study/SourceChip";

export type OmniStatement = {
  id: string;
  text: string;
  topic: string;
  pageLabel: string;
  ref: ChipRef | null;
};

export type OmniOpenItem = {
  id: string;
  title: string;
  kind: "needs" | "missing" | "changed" | "received";
  detail?: string;
  ref: ChipRef | null;
};

export type OmniDocumentHit = {
  id: string;
  role: string;
  typeLabel: string;
  period: string;
  pages: number;
  ref: ChipRef | null;
  /** Authorized file name for client-side document-name search (never triggers a model call). */
  fileName?: string;
};

/** What the box finds in (statements, open items, documents) plus the chat's starter questions. */
export type OmniCatalog = {
  /** Starter questions for the chat. The box never searches them. */
  suggestions: readonly string[];
  statements: readonly OmniStatement[];
  openItems: readonly OmniOpenItem[];
  documents: readonly OmniDocumentHit[];
};

export const EMPTY_OMNI_CATALOG: OmniCatalog = {
  suggestions: [],
  statements: [],
  openItems: [],
  documents: [],
};

export type OmniHit =
  | { kind: "statement"; id: string; statement: OmniStatement }
  | { kind: "item"; id: string; item: OmniOpenItem }
  | { kind: "document"; id: string; document: OmniDocumentHit };