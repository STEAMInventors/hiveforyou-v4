"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
};

export type OmniQuestion = {
  id: string;
  question: string;
  answer: string;
  refs: readonly ChipRef[];
};

export type OmniCatalog = {
  suggestions: readonly string[];
  statements: readonly OmniStatement[];
  openItems: readonly OmniOpenItem[];
  documents: readonly OmniDocumentHit[];
  yourQuestions: readonly OmniQuestion[];
  clientQuestions: readonly OmniQuestion[];
  clientName: string | null;
};

export const EMPTY_OMNI_CATALOG: OmniCatalog = {
  suggestions: [],
  statements: [],
  openItems: [],
  documents: [],
  yourQuestions: [],
  clientQuestions: [],
  clientName: null,
};

export type OmniHit =
  | { kind: "ask"; id: "ask" }
  | { kind: "suggestion"; id: string; text: string }
  | { kind: "question"; id: string; question: OmniQuestion; audience: "yours" | "client" }
  | { kind: "statement"; id: string; statement: OmniStatement }
  | { kind: "item"; id: string; item: OmniOpenItem }
  | { kind: "document"; id: string; document: OmniDocumentHit };

function includes(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

export function omniHits(catalog: OmniCatalog, rawQuery: string): OmniHit[] {
  const query = rawQuery.trim().toLowerCase();
  const hits: OmniHit[] = [{ kind: "ask", id: "ask" }];
  if (!query) {
    for (const [index, text] of catalog.suggestions.slice(0, 3).entries()) {
      hits.push({ kind: "suggestion", id: `suggestion-${index}`, text });
    }
    for (const question of catalog.yourQuestions.slice(0, 5)) {
      hits.push({ kind: "question", id: `yours-${question.id}`, question, audience: "yours" });
    }
    for (const question of catalog.clientQuestions.slice(0, 5)) {
      hits.push({ kind: "question", id: `client-${question.id}`, question, audience: "client" });
    }
    return hits;
  }
  for (const statement of catalog.statements) {
    if (hits.filter((hit) => hit.kind === "statement").length >= 4) break;
    if (includes(statement.text, query) || includes(statement.topic, query)) {
      hits.push({ kind: "statement", id: `statement-${statement.id}`, statement });
    }
  }
  for (const item of catalog.openItems) {
    if (hits.filter((hit) => hit.kind === "item").length >= 3) break;
    if (includes(item.title, query) || includes(item.detail ?? "", query)) {
      hits.push({ kind: "item", id: `item-${item.id}`, item });
    }
  }
  for (const document of catalog.documents) {
    if (hits.filter((hit) => hit.kind === "document").length >= 3) break;
    const blob = `${document.role} ${document.typeLabel} ${document.period}`;
    if (includes(blob, query)) {
      hits.push({ kind: "document", id: `document-${document.id}`, document });
    }
  }
  return hits;
}

export function omniHasMatches(hits: readonly OmniHit[]): boolean {
  return hits.some((hit) => hit.kind !== "ask");
}

export type TextPiece = { text: string; match: boolean };

export function highlightPieces(text: string, rawQuery: string): TextPiece[] {
  const query = rawQuery.trim();
  if (!query) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const pieces: TextPiece[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = lower.indexOf(needle, cursor);
    if (at === -1) {
      pieces.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (at > cursor) pieces.push({ text: text.slice(cursor, at), match: false });
    pieces.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  return pieces.filter((piece) => piece.text.length > 0);
}

type OmniCatalogContextValue = {
  catalog: OmniCatalog;
  setCatalog: (catalog: OmniCatalog) => void;
};

const OmniCatalogContext = createContext<OmniCatalogContextValue | null>(null);

export function OmniCatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<OmniCatalog>(EMPTY_OMNI_CATALOG);
  const value = useMemo(() => ({ catalog, setCatalog }), [catalog]);
  return <OmniCatalogContext.Provider value={value}>{children}</OmniCatalogContext.Provider>;
}

export function useOmniCatalog(): OmniCatalog {
  return useContext(OmniCatalogContext)?.catalog ?? EMPTY_OMNI_CATALOG;
}

/** Pages publish the records they already loaded. The box never fetches them. */
export function useRegisterOmniCatalog(catalog: OmniCatalog) {
  const ctx = useContext(OmniCatalogContext);
  const serialized = JSON.stringify(catalog);
  useEffect(() => {
    if (!ctx) return;
    ctx.setCatalog(catalog);
    // serialized is the change signal; catalog is the value captured for that string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, serialized]);
  useEffect(() => {
    return () => ctx?.setCatalog(EMPTY_OMNI_CATALOG);
  }, [ctx]);
}
