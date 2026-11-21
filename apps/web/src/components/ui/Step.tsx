import type { ReactNode } from "react";

export function Step({
  status,
  title,
  detail,
  action,
}: {
  status?: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-x-5 gap-y-1 border-b border-line py-4 min-[760px]:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex flex-wrap items-center gap-2.5 text-[14.5px] font-semibold text-ink">
        {status}
        <span>{title}</span>
      </div>
      {detail ? <p className="m-0 text-[13.5px] leading-snug text-ink-2 min-[760px]:col-start-1">{detail}</p> : <span className="hidden min-[760px]:col-start-1 min-[760px]:block" />}
      {action ? <div className="mt-1.5 min-[760px]:col-start-2 min-[760px]:row-span-2 min-[760px]:row-start-1 min-[760px]:mt-0">{action}</div> : null}
    </div>
  );
}
