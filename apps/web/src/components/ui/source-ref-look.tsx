/** The `.ref` look (DESIGN §3 "Source reference"), shared by the interactive SourceRef and static previews. */
export const SOURCE_REF_CLASS =
  "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-ref border border-line bg-paper px-2 text-[12px] font-medium text-ink-2 max-[759px]:min-h-10";

export function SourceRefIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-70"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
