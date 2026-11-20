"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { EMPTY_OMNI_CATALOG, type OmniCatalog } from "./omni-catalog";

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
