"use client";

import type { ReactNode } from "react";

import { AppShell, type AppShellAccount } from "@/components/app-header";
import type { HiveChatConfig } from "@/lib/hive-chat-context";

import { WorkspaceShell, type WorkspaceShellProps } from "./WorkspaceShell";

/** Hive workspace chrome: shell props and chat config are fixed before the first client paint. */
export function HivePageChrome({
  account,
  chatConfig,
  shellProps,
  children,
}: {
  account: AppShellAccount;
  chatConfig: HiveChatConfig;
  shellProps: Omit<WorkspaceShellProps, "children" | "chatConfig" | "viewerDisplayName">;
  children: ReactNode;
}) {
  return (
    <AppShell account={account} chatConfig={chatConfig}>
      <WorkspaceShell {...shellProps} chatConfig={chatConfig} viewerDisplayName={account.displayName ?? null}>
        {children}
      </WorkspaceShell>
    </AppShell>
  );
}