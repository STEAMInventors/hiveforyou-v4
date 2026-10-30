export function SourceChip() {
  return (
    <p className="mb-0 mt-4 text-sm text-ink-muted">
      Example source chip (visual only):{" "}
      <span
        className="inline-flex items-center rounded-md border border-honey/40 bg-honey-wash px-2 py-0.5 font-mono text-[13px] text-honey-deep"
        aria-label="Example source chip, not linked to evidence"
      >
        Receipt · p.1
      </span>
    </p>
  );
}
