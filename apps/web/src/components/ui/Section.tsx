import type { ReactNode } from "react";

export type SectionProps = {
  id?: string;
  title: string;
  headingRight?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ id, title, headingRight, children, className = "" }: SectionProps) {
  return (
    <section id={id} className={`mt-9 first:mt-0 ${className}`.trim()}>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
        <h2 className="m-0 font-brand text-section font-semibold text-ink">{title}</h2>
        {headingRight ? <div className="shrink-0 text-meta text-ink-3">{headingRight}</div> : null}
      </header>
      {children}
    </section>
  );
}