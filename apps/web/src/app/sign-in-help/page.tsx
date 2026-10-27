import Link from "next/link";

import { AuthFrame, AuthHeading } from "@/components/auth/AuthFrame";
import {
  SIGN_IN_HELP_BODY,
  SIGN_IN_HELP_TITLE,
} from "@/server/auth/messages";
import { safeNextPath } from "@/server/auth/redirects";

type PageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignInHelpPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next, "/hives");
  const nextQuery = encodeURIComponent(next);

  return (
    <AuthFrame>
      <AuthHeading title={SIGN_IN_HELP_TITLE} lede={SIGN_IN_HELP_BODY} />
      <p
        className="muted"
        style={{ margin: 0, textAlign: "center", fontSize: "0.875rem" }}
      >
        <Link href={`/login?next=${nextQuery}`}>Back to log in</Link>
        <span aria-hidden> · </span>
        <Link href={`/forgot-password?next=${nextQuery}`}>Forgot password</Link>
        <span aria-hidden> · </span>
        <Link href={`/register?next=${nextQuery}`}>Create an account</Link>
      </p>
    </AuthFrame>
  );
}
