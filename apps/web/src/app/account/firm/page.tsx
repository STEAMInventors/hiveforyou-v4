import { FirmTeamPanel } from "@/components/firm/FirmTeamPanel";
import { loadFirm } from "@/server/firm/load-firm";
import { loadPracticeAreaSetupOptions } from "@/server/firm/practice-area-options";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function FirmAccountPage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    return null;
  }
  const [firm, practiceAreaOptions] = await Promise.all([loadFirm(auth.client), loadPracticeAreaSetupOptions()]);
  return <FirmTeamPanel initial={firm} practiceAreaOptions={practiceAreaOptions} />;
}