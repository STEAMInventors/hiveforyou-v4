import { buildNewClientChecklistRows, packOptionsFromEntries } from "@hiveforyou/contracts";
import { redirect } from "next/navigation";

import { NewClientHiveForm } from "@/components/hives/NewClientHiveForm";
import { fetchMyProfile } from "@/lib/auth/profile";
import { loadFirm } from "@/server/firm/load-firm";
import { loadPackEntries } from "@/server/pipeline/pack-loader";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

type NewClientPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewClientHivePage({ searchParams }: NewClientPageProps) {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    redirect("/sign-in?next=%2Fhives%2Fnew-client");
  }
  const { profile } = await fetchMyProfile(auth.client);
  if (!profile) {
    redirect("/welcome?next=%2Fhives%2Fnew-client");
  }

  const params = await searchParams;
  const nameParam = params.name;
  const initialName = typeof nameParam === "string" ? nameParam : Array.isArray(nameParam) ? nameParam[0] : undefined;

  const { entries } = loadPackEntries();
  const packOptions = packOptionsFromEntries(entries);
  const firm = await loadFirm(auth.client);
  const firmPracticeAreas = firm?.firm?.practiceAreas ?? null;

  const packCatalog = packOptions.map((option) => {
    const entry = entries.find((row) => row.id === option.id);
    return {
      ...option,
      rows: entry ? buildNewClientChecklistRows(entry.pack) : [],
    };
  });

  return (
    <NewClientHiveForm
      packCatalog={packCatalog}
      initialName={initialName}
      firmPracticeAreas={firmPracticeAreas}
    />
  );
}