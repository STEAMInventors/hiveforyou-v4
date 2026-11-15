import { redirect } from "next/navigation";

import { NewClientHiveForm } from "@/components/hives/NewClientHiveForm";
import { fetchMyProfile } from "@/lib/auth/profile";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function NewClientHivePage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    redirect("/sign-in?next=%2Fhives%2Fnew-client");
  }
  const { profile } = await fetchMyProfile(auth.client);
  if (!profile) {
    redirect("/welcome?next=%2Fhives%2Fnew-client");
  }

  return <NewClientHiveForm />;
}