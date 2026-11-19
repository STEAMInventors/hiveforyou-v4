import type { ReactNode } from "react";

import { SourceRefs } from "./SourceRefs";
import type { ChipRef } from "@/components/study/SourceChip";
import { StatusDot } from "./StatusDot";
import type { DisplayState } from "@/components/study/status-state";

export type ItemRowProps = {
  state: DisplayState;
  title: string;
  detail?: string;
  refs?: readonly ChipRef[];
  action?: ReactNode;
};

export function ItemRow({ state, title, detail, refs, action }: ItemRowProps) {
  return (
    <div className="grid gap-x-3 gap-y-1 border-b border-line py-3.5 max-[899px]:grid-cols-1 min-[900px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[900px]:items-start">
      <div className="min-[900px]:col-span-1">
        <StatusDot state={state} />
      </div>
      <div className="min-w-0 min-[900px]:col-span-1">
        <p className="m-0 text-item font-semibold text-ink">{title}</p>
        {detail ? <p className="m-0 mt-0.5 text-small text-ink-2">{detail}</p> : null}
        {refs?.length ? <SourceRefs refs={refs} /> : null}
      </div>
      {action ? (
        <div className="min-[900px]:col-span-1 min-[900px]:justify-self-end max-[899px]:mt-1">{action}</div>
      ) : null}
    </div>
  );
}