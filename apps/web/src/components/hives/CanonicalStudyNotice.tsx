import { OLDER_STUDY_NOTICE } from "@/lib/hives/study-availability";

/** One-line notice when the accepted study is not in the canonical-study-1 view format. */
export function CanonicalStudyNotice() {
  return (
    <p className="m-0 max-w-prose text-body text-ink-2" data-testid="canonical-study-notice">
      {OLDER_STUDY_NOTICE}
    </p>
  );
}