"use client";

import { useEffect, useState } from "react";

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ProgressElapsed(props: {
  startedAt: string | null | undefined;
  stepLabel?: string | null;
  detail?: string | null;
  typicalRange?: string | null;
}) {
  const startedMs = props.startedAt ? Date.parse(props.startedAt) : null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!startedMs || !Number.isFinite(startedMs)) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedMs]);

  if (!startedMs || !Number.isFinite(startedMs)) return null;

  const elapsedSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));

  return (
    <div className="flex flex-col gap-0.5" data-testid="progress-elapsed">
      <p className="m-0 font-mono text-[15px] tabular-nums text-ink" aria-live="polite">
        Running for {formatElapsed(elapsedSeconds)}
      </p>
      {props.stepLabel ? (
        <p className="m-0 text-[13px] text-ink">{props.stepLabel}</p>
      ) : null}
      {props.detail ? <p className="m-0 text-[12px] text-ink-muted">{props.detail}</p> : null}
      {props.typicalRange ? <p className="m-0 text-[12px] text-ink-muted">Usually {props.typicalRange}</p> : null}
    </div>
  );
}
