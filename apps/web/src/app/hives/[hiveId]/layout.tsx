import type { ReactNode } from "react";

import { isKnownDemoHiveId } from "@/lib/demo-scaffold";

type HiveLayoutProps = {
  children: ReactNode;
  params: Promise<{ hiveId: string }>;
};

export default async function HiveLayout({ children, params }: HiveLayoutProps) {
  const { hiveId } = await params;

  if (!isKnownDemoHiveId(hiveId)) {
    return children;
  }

  return <div data-hive-id={hiveId}>{children}</div>;
}
