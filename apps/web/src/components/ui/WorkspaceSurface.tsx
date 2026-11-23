import type { ReactNode } from "react";

export type WorkspaceSurfaceTone = "blue" | "mist" | "paper";

const HEADER: Record<WorkspaceSurfaceTone, string> = {
  blue: "border-b border-line bg-blue-wash",
  mist: "border-b border-line bg-mist",
  paper: "border-b border-line bg-paper",
};

/** A bordered workspace panel with one tinted header. */
export function WorkspaceSurface({
  title,
  detail,
  meta,
  tone = "paper",
  children,
  className = "",
  testId,
  bodyClassName = "",
}: {
  title: string;
  detail?: string;
  meta?: ReactNode;
  tone?: WorkspaceSurfaceTone;
  children: ReactNode;
  className?: string;
  testId?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[12px] border border-line bg-paper ${className}`.trim()}
    >
      <header className={`shrink-0 px-3.5 py-2.5 ${HEADER[tone]}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0 font-brand text-[16px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
          {meta ? <div className="shrink-0 text-meta font-semibold text-ink-3">{meta}</div> : null}
        </div>
        {detail ? <p className="m-0 mt-0.5 text-meta text-ink-2">{detail}</p> : null}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`.trim()}>{children}</div>
    </section>
  );
}

/** Compact tinted page header used on hive sections. */
export function SectionBand({
  title,
  detail,
  tone = "blue",
  aside,
  testId,
}: {
  title: string;
  detail?: string;
  tone?: "blue" | "mist";
  aside?: ReactNode;
  testId?: string;
}) {
  return (
    <header
      data-testid={testId}
      className={`rounded-[12px] border border-line px-4 py-3 ${tone === "mist" ? "bg-mist" : "bg-blue-wash"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 font-brand text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h2>
          {detail ? <p className="m-0 mt-1 text-meta text-ink-2">{detail}</p> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
    </header>
  );
}
