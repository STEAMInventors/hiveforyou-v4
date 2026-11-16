import { redirect } from "next/navigation";

import { safeNextPath } from "@/server/auth/redirects";

type PageProps = {
  searchParams: Promise<{ next?: string; start?: string; new?: string; error?: string; info?: string }>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next, "/hives");
  const destination = new URLSearchParams({ next });
  if (params.start) {
    destination.set("start", params.start);
  }
  if (params.new) {
    destination.set("new", params.new);
  }
  if (params.error) {
    destination.set("error", params.error);
  }
  redirect(`/sign-in?${destination.toString()}`);
}