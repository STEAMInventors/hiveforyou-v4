"use client";

import type { ReactNode } from "react";

import type { ChipRef } from "@/components/study/SourceChip";
import { useEvidenceViewer } from "@/components/study/EvidenceViewer";
import type { DisplayState } from "@/components/study/status-state";

import { SourceRefs } from "./SourceRefs";
import { StatusDot } from "./StatusDot";

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
    <div className="mt-[22px] first:mt-0">
      <h3 className="m-0 mb-1 flex flex-wrap items-center gap-2.5 font-sans text-topic font-semibold text-ink-3">
        {title}
        {count != null ? <span className="text-meta font-normal text-ink-3">{count}</span> : null}
        {uncertain ? <StatusDot state="uncertain" /> : null}
      </h3>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export function Statement({
  body,
  refs,
  onOpen,
}: {
  body: string;
  refs?: readonly ChipRef[];
  onOpen?: () => void;
}) {
  const viewer = useEvidenceViewer();
  const chips = refs ?? [];
  const first = chips[0];
  const activate = onOpen ?? (first ? () => viewer.open(first) : undefined);
  const content = (
    <>
      <span className="text-body text-ink">{body}</span>
      {activate ? (
        <span className="ml-1.5 whitespace-nowrap text-[12.5px] font-semibold text-blue-deep opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          See the page →
        </span>
      ) : null}
      {chips.length ? <SourceRefs refs={chips} inert /> : null}
    </>
  );
  if (!activate) {
    return <div className="border-b border-line py-3.5">{content}</div>;
  }
  return (
    <button
      type="button"
      className="group -mx-3 block w-[calc(100%+24px)] rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-mist"
      onClick={activate}
    >
      {content}
    </button>
  );
}

export function StatementStatus({ state, label }: { state: DisplayState; label?: string }) {
  return <StatusDot state={state} label={label} />;
}
