"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card" role="alert">
      <h1 style={{ marginTop: 0, fontSize: "1.25rem" }}>Something went wrong</h1>
      <p className="muted">
        We could not load this page. Your documents and Study are not changed by this preview shell.
      </p>
      <p className="muted" style={{ fontSize: "0.875rem" }}>
        If this keeps happening, note the time and contact support. Technical details are not shown here.
      </p>
      <button type="button" className="button" onClick={() => reset()} style={{ marginTop: "0.75rem" }}>
        Try again
      </button>
    </div>
  );
}
