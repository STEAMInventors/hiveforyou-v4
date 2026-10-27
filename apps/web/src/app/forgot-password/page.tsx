import { AuthFrame, AuthHeading } from "@/components/auth/AuthFrame";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { authLinkErrorMessage } from "@/server/auth/messages";
import { safeNextPath } from "@/server/auth/redirects";

type PageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function ForgotPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next, "/hives");
  const linkError = authLinkErrorMessage(params.error, "recovery");

  return (
    <AuthFrame>
      <AuthHeading
        title="Reset your password"
        lede="Enter the email on your account. If it's registered, we'll email a reset code you can enter here—without opening the link if your mail app scans links."
      />
      <ForgotPasswordForm nextPath={next} linkError={linkError} />
    </AuthFrame>
  );
}
