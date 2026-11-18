import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  /** In-page link target, e.g. `#requested`. */
  id?: string;
};

export function Card({ title, subtitle, headerRight, children, className = "", testId, id }: CardProps) {
  const hasHeader = title || subtitle || headerRight;
  return (
    <section
      id={id}
      className={`flex flex-col rounded-card border border-line bg-paper px-[18px] py-4 ${id ? "scroll-mt-6" : ""} ${className}`.trim()}
      data-testid={testId}
    >
      {hasHeader ? (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? <h2 className="m-0 text-body font-semibold text-ink">{title}</h2> : null}
            {subtitle ? <p className="m-0 mt-0.5 text-caption text-graphite">{subtitle}</p> : null}
          </div>
          {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}