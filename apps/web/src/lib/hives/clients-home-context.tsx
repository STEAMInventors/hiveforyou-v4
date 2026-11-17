"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ClientsHomeContextValue = {
  enabled: boolean;
  findQuery: string;
  setFindQuery: (value: string) => void;
};

const ClientsHomeContext = createContext<ClientsHomeContextValue | null>(null);

export function ClientsHomeProvider({
  children,
  enabled,
  initialQuery = "",
}: {
  children: ReactNode;
  enabled: boolean;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [findQuery, setFindQueryState] = useState(initialQuery);

  useEffect(() => {
    setFindQueryState(initialQuery);
  }, [initialQuery]);

  const setFindQuery = useCallback(
    (value: string) => {
      setFindQueryState(value);
      if (!enabled) return;
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const trimmed = value.trim();
      if (trimmed) {
        params.set("q", trimmed);
      } else {
        params.delete("q");
      }
      const query = params.toString();
      router.replace(query ? `/hives?${query}` : "/hives", { scroll: false });
    },
    [enabled, router],
  );

  const value = useMemo(() => ({ enabled, findQuery, setFindQuery }), [enabled, findQuery, setFindQuery]);
  return <ClientsHomeContext.Provider value={value}>{children}</ClientsHomeContext.Provider>;
}

export function useClientsHomeSearch(): ClientsHomeContextValue | null {
  return useContext(ClientsHomeContext);
}