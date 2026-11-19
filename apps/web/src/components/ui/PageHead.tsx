import type { ReactNode } from "react";

export type PageHeadProps = {
  breadcrumb?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function PageHead({ breadcrumb, title, description, action }: PageHeadProps) {
  return (
    <header className="mb-9 flex flex-col gap-2 min-[600px]:mb-7 min-[600px]:flex-row min-[600px]:items-start min-[600px]:justify-between" data-testid="page-head">
      <div className="min-w-0 flex-1">
        {breadcrumb ? <div className="mb-3.5 text-meta text-ink-3">{breadcrumb}</div> : null}
        <h1 className="m-0 font-brand text-title-sm font-semibold text-ink min-[600px]:text-title">{title}</h1>
        {description ? <p className="m-0 mt-1.5 text-body text-ink-2">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}