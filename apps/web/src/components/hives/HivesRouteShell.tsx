"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell, type AppShellAccount } from "@/components/app-header";

const HIVE_WORKSPACE_PATH = /^\/hives\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Wraps list and tooling routes; hive workspace pages bring their own AppShell with chat config. */
export function HivesRouteShell({
  account,
  children,
}: {
  account: AppShellAccount;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "";
  if (HIVE_WORKSPACE_PATH.test(pathname)) {
    return <>{children}</>;
  }
  return <AppShell account={account}>{children}</AppShell>;
}