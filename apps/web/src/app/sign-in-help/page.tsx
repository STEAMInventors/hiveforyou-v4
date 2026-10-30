import Link from "next/link";

import { AuthFrame, AuthHeading } from "@/components/auth/AuthFrame";
import { TEXT_LINK_CLASS } from "@/components/button-classes";
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
      <p className="m-0 text-center text-sm leading-relaxed text-ink-muted">
        <Link href={`/login?next=${nextQuery}`} className={TEXT_LINK_CLASS}>
          Back to log in
        </Link>
        <span aria-hidden> · </span>
        <Link
          href={`/forgot-password?next=${nextQuery}`}
          className={TEXT_LINK_CLASS}
        >
          Forgot password
        </Link>
        <span aria-hidden> · </span>
        <Link href={`/register?next=${nextQuery}`} className={TEXT_LINK_CLASS}>
          Create an account
        </Link>
      </p>
    </AuthFrame>
  );
}
