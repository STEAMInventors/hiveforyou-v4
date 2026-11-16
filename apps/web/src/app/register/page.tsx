import { redirect } from "next/navigation";

import { safeNextPath } from "@/server/auth/redirects";

type PageProps = {
  searchParams: Promise<{ next?: string; start?: string }>;
};

export default async function RegisterPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next, "/hives");
  const destination = new URLSearchParams({ next });
  if (params.start) {
    destination.set("start", params.start);
  }
  destination.set("new", "1");
  redirect(`/sign-in?${destination.toString()}`);
}