"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import {
  EMPTY_OMNI_CATALOG,
  type OmniCatalog,
  type OmniDocumentHit,
  type OmniHit,
  type OmniOpenItem,
  type OmniStatement,
} from "@/lib/omni-catalog-model";

export type { OmniCatalog, OmniDocumentHit, OmniHit, OmniOpenItem, OmniStatement };
export { EMPTY_OMNI_CATALOG } from "@/lib/omni-catalog-model";
export {
  highlightPieces,
  omniHasMatches,
  omniHits,
  type TextPiece,
} from "@/lib/omni-catalog-search";

// The value and the setter live in separate contexts: a page that publishes the catalog also reads
// the provider, so a setter bundled with the value would change identity on every publish and loop.
type SetOmniCatalog = (catalog: OmniCatalog) => void;

const OmniCatalogValueContext = createContext<OmniCatalog | null>(null);
const OmniCatalogSetterContext = createContext<SetOmniCatalog | null>(null);

export function OmniCatalogProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<OmniCatalog>(EMPTY_OMNI_CATALOG);
  return (
    <OmniCatalogSetterContext.Provider value={setCatalog}>
      <OmniCatalogValueContext.Provider value={catalog}>{children}</OmniCatalogValueContext.Provider>
    </OmniCatalogSetterContext.Provider>
  );
}

export function useOmniCatalog(): OmniCatalog {
  return useContext(OmniCatalogValueContext) ?? EMPTY_OMNI_CATALOG;
}

/** Pages publish the records they already loaded. The box never fetches them. */
/** @param enabled When false, this surface leaves the catalog to another publisher (e.g. the evidence view). */
export function useRegisterOmniCatalog(catalog: OmniCatalog, enabled = true) {
  const setCatalog = useContext(OmniCatalogSetterContext);
  const serialized = JSON.stringify(catalog);
  useEffect(() => {
    if (!setCatalog || !enabled) return;
    setCatalog(JSON.parse(serialized) as OmniCatalog);
    return () => setCatalog(EMPTY_OMNI_CATALOG);
  }, [enabled, setCatalog, serialized]);
}
