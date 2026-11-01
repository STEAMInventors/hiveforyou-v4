type TabEmptyStateProps = {
  variant: "documents" | "study" | "reports";
};

const copy: Record<
  TabEmptyStateProps["variant"],
  { title: string; body: string }
> = {
  documents: {
    title: "No documents yet",
    body: "When you add files to this Hive, they will appear here with honest registration status.",
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

export function TabEmptyState({ variant }: TabEmptyStateProps) {
  const content = copy[variant];
  const titleId = `empty-${variant}-title`;

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col items-start gap-3.5 rounded-card border border-dashed border-line-strong bg-paper px-8 py-14"
    >
      <h2 id={titleId} className="m-0 font-brand text-[21px] font-medium text-ink">
        {content.title}
      </h2>
      <p className="m-0 max-w-[560px] text-[15px] leading-[1.55] text-ink-muted">
        {content.body}
      </p>
    </section>
  );
}
