import type { ReactNode } from "react";

export type SectionTone = "rule" | "blue" | "mist" | "coral";

const HEADER: Record<SectionTone, string> = {
  rule: "border-b border-ink pb-2.5",
  blue: "mb-3 rounded-[10px] border border-line bg-blue-wash px-3 py-2",
  mist: "mb-3 rounded-[10px] border border-line bg-mist px-3 py-2",
  coral: "mb-3 rounded-[10px] border border-line bg-coral-wash px-3 py-2",
};

export type SectionProps = {
  id?: string;
  title: string;
  headingRight?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Tinted header for hive sections. The default keeps the ink rule. */
  tone?: SectionTone;
};

export function Section({ id, title, headingRight, children, className = "", tone = "rule" }: SectionProps) {
  return (
    <section id={id} className={`mt-10 first:mt-0 ${className}`.trim()}>
      <header className={`mb-0 flex items-baseline justify-between gap-3 ${HEADER[tone]}`}>
        <h2 className="m-0 font-brand text-section font-semibold tracking-[-0.015em] text-ink">{title}</h2>
        {headingRight ? <div className="shrink-0 text-meta tabular-nums text-ink-3">{headingRight}</div> : null}
      </header>
      {children}
    </section>
  );
}
