type TabEmptyStateProps = {
  variant: "documents" | "study" | "reports";
};

const copy: Record<
  TabEmptyStateProps["variant"],
  { title: string; body: string }
> = {
  documents: {
    title: "No documents yet",
    body: "When document upload is enabled, your source documents will appear here with honest processing status — not before.",
  },
  study: {
    title: "No accepted Study yet",
    body: "A Canonical Study appears only after documents are processed and evidence is accepted. This Hive has no Study yet.",
  },
  reports: {
    title: "No reports yet",
    body: "Reports are generated from an accepted Study revision. Nothing has been generated in this Hive yet.",
  },
};

function DocumentIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
    </svg>
  );
}

export function TabEmptyState({ variant }: TabEmptyStateProps) {
  const content = copy[variant];
  const titleId = `empty-${variant}-title`;

  if (variant === "documents") {
    return (
      <section
        aria-labelledby={titleId}
        className="flex flex-col items-center rounded-[18px] border-2 border-dashed border-line-strong bg-paper px-6 py-12 text-center"
      >
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-mist text-ink-muted">
          <DocumentIcon />
        </span>
        <h2 id={titleId} className="m-0 text-lg font-semibold text-ink">
          {content.title}
        </h2>
        <p className="mx-auto mb-0 mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
          {content.body}
        </p>
        <p className="mb-0 mt-3 text-xs text-ink-muted">
          Supported when available: PDF, PNG, JPG and DOCX.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-[18px] border border-line bg-paper p-8 text-center"
    >
      <h2 id={titleId} className="m-0 text-lg font-semibold text-ink">
        {content.title}
      </h2>
      <p className="mx-auto mb-0 mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        {content.body}
      </p>
    </section>
  );
}
