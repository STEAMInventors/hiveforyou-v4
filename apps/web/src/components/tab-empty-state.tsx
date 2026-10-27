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

export function TabEmptyState({ variant }: TabEmptyStateProps) {
  const content = copy[variant];
  return (
    <section className="card" aria-labelledby={`empty-${variant}-title`}>
      <h2
        id={`empty-${variant}-title`}
        style={{ marginTop: 0, fontSize: "1.125rem" }}
      >
        {content.title}
      </h2>
      <p className="muted" style={{ marginBottom: 0 }}>
        {content.body}
      </p>
    </section>
  );
}
