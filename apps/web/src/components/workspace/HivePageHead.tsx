type HivePageHeadProps = {
  title: string;
  subtitle?: string;
};

/** Compact workspace page title (D18); hive identity lives in the sidebar and breadcrumb. */
export function HivePageHead({ title, subtitle }: HivePageHeadProps) {
  return (
    <header className="mb-4 flex flex-col gap-1" data-testid="hive-page-head">
      <h1 className="m-0 font-brand text-section font-semibold text-ink">{title}</h1>
      {subtitle ? <p className="m-0 text-small text-graphite">{subtitle}</p> : null}
    </header>
  );
}