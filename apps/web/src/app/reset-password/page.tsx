import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthFrame, AuthHeading } from "@/components/auth/AuthFrame";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import {
  FORGOT_PASSWORD_PATH,
  RECOVERY_COOKIE_NAME,
  isRecoveryResetSession,
} from "@/server/auth/recovery";
import { requireAuthenticatedUser } from "@/server/supabase/server-client";

export default async function ResetPasswordPage() {
  const auth = await requireAuthenticatedUser();
  const cookieStore = await cookies();
  if (
    !isRecoveryResetSession(
      auth.ok,
      cookieStore.get(RECOVERY_COOKIE_NAME)?.value,
    )
  ) {
    redirect(`${FORGOT_PASSWORD_PATH}?error=link_invalid`);
  }

  return (
    <AuthFrame>
      <AuthHeading
        title="Choose a new password"
        lede="This link opened a temporary sign-in. Set a new password before you continue."
      />
      <ResetPasswordForm />
    </AuthFrame>
  );
}
