export function ProgressMeter({
  received,
  total,
  fullWidth = false,
  labelled = false,
}: {
  received: number;
  total: number;
  fullWidth?: boolean;
  labelled?: boolean;
}) {
  if (total <= 0) return null;
  const filled = Math.max(0, Math.min(received, total));
  return (
    <div>
      <div
        className={`mt-[18px] flex gap-[3px] ${fullWidth ? "max-w-none" : "max-w-[420px]"}`}
        role="img"
        aria-label={`${filled} of ${total} documents in`}
        data-testid="progress-meter"
      >
        {Array.from({ length: total }, (_, index) => (
          <i
            key={index}
            aria-hidden
            className={`h-1.5 flex-1 rounded-[3px] ${index < filled ? "bg-leaf" : "bg-line"}`}
          />
        ))}
      </div>
      {labelled ? (
        <p className="m-0 mt-2 text-meta tabular-nums text-ink-3">
          {filled} of {total} documents in
        </p>
      ) : null}
    </div>
  );
}
