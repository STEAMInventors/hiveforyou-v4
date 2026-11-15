"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type ClientsHomeContextValue = {
  enabled: boolean;
  findQuery: string;
  setFindQuery: (value: string) => void;
};

const ClientsHomeContext = createContext<ClientsHomeContextValue | null>(null);

export function ClientsHomeProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const [findQuery, setFindQuery] = useState("");
  const value = useMemo(() => ({ enabled, findQuery, setFindQuery }), [enabled, findQuery]);
  return <ClientsHomeContext.Provider value={value}>{children}</ClientsHomeContext.Provider>;
}

export function useClientsHomeSearch(): ClientsHomeContextValue | null {
  return useContext(ClientsHomeContext);
}