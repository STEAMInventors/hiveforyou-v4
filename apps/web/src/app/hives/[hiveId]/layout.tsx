import type { ReactNode } from "react";

type HiveLayoutProps = {
  children: ReactNode;
  params: Promise<{ hiveId: string }>;
};

export default async function HiveLayout({
  children,
  params,
}: HiveLayoutProps) {
  const { hiveId } = await params;
  return <div data-hive-id={hiveId}>{children}</div>;
}
