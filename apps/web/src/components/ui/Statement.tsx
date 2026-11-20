import type { ReactNode } from "react";

import type { ChipRef } from "@/components/study/SourceChip";

import { SourceRefs } from "./SourceRefs";
import { StatusDot } from "./StatusDot";
import type { DisplayState } from "@/components/study/status-state";

export function StatementTopic({
  title,
  count,
  uncertain,
  children,
}: {
  title: string;
  count?: number;
  uncertain?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="m-0 flex flex-wrap items-baseline gap-2 text-item font-semibold text-ink">
        {title}
        {count != null ? <span className="text-meta font-normal text-ink-3">{count}</span> : null}
        {uncertain ? <StatusDot state="uncertain" /> : null}
      </h3>
      <div className="mt-2 flex flex-col">{children}</div>
    </div>
  );
}

export function Statement({ body, refs }: { body: string; refs?: readonly ChipRef[] }) {
  return (
    <div className="border-b border-line py-3.5">
      <p className="m-0 text-body text-ink">{body}</p>
      {refs?.length ? <SourceRefs refs={refs} /> : null}
    </div>
  );
}

export function StatementStatus({ state, label }: { state: DisplayState; label?: string }) {
  return <StatusDot state={state} label={label} />;
}