"use client";

import { createContext, useContext, type ReactNode } from "react";

const WorkspaceChromeContext = createContext(false);

export function WorkspaceChromeProvider({ children }: { children: ReactNode }) {
  return <WorkspaceChromeContext.Provider value={true}>{children}</WorkspaceChromeContext.Provider>;
}

export function useWorkspaceChrome(): boolean {
  return useContext(WorkspaceChromeContext);
}