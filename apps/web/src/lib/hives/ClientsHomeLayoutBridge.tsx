"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { ClientsHomeProvider } from "./clients-home-context";

export function ClientsHomeLayoutBridge({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  return (
    <ClientsHomeProvider enabled={enabled} initialQuery={initialQuery}>
      {children}
    </ClientsHomeProvider>
  );
}