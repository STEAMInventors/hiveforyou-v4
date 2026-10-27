import { isValidUuid } from "@hiveforyou/contracts";
import { notFound, redirect } from "next/navigation";

type HiveRootPageProps = {
  params: Promise<{ hiveId: string }>;
};

export default async function HiveRootPage({ params }: HiveRootPageProps) {
  const { hiveId } = await params;
  const trimmed = hiveId.trim().toLowerCase();
  if (!isValidUuid(trimmed)) {
    notFound();
  }
  redirect(`/hives/${trimmed}/documents`);
}
