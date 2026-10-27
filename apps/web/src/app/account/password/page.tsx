import { redirect } from "next/navigation";

import { AuthFrame, AuthHeading } from "@/components/auth/AuthFrame";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";
import { ACCOUNT_PASSWORD_PATH } from "@/server/auth/recovery";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function AccountPasswordPage() {
  const auth = await requireAuthenticatedUser();
  if (!auth.ok) {
    redirect(`/login?next=${encodeURIComponent(ACCOUNT_PASSWORD_PATH)}`);
  }

  return (
    <AuthFrame>
      <AuthHeading
        title="Change password"
        lede="Enter your current password, then choose a new one."
      />
      <ChangePasswordForm email={auth.email ?? ""} />
    </AuthFrame>
  );
}
