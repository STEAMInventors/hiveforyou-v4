import { FirmTeamPanel } from "@/components/firm/FirmTeamPanel";
import { loadFirm } from "@/server/firm/load-firm";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function FirmAccountPage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return null;
  }
  const firm = await loadFirm(auth.client);
  return <FirmTeamPanel initial={firm} />;
}