"use client";

import type { ProgressEstimate } from "@hiveforyou/contracts";
import { useEffect, useState } from "react";

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatRangeLabel(estimate: ProgressEstimate): string {
  const lowMin = Math.max(1, Math.round((Date.parse(estimate.estimatedCompletionLowAt) - Date.now()) / 60_000));
  const highMin = Math.max(
    lowMin,
    Math.round((Date.parse(estimate.estimatedCompletionHighAt) - Date.now()) / 60_000),
  );
  if (lowMin === highMin) return `estimated ${lowMin} min`;
  return `estimated ${lowMin}–${highMin} min`;
}

export function ProgressCountdown(props: { estimate: ProgressEstimate | null | undefined }) {
  const targetMs = props.estimate ? Date.parse(props.estimate.estimatedCompletionAt) : null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!targetMs) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [targetMs, props.estimate?.estimatedCompletionAt]);

  if (!props.estimate || !targetMs) return null;

  const remainingSeconds = Math.ceil((targetMs - nowMs) / 1000);
  if (remainingSeconds <= 0) {
    return (
      <p className="m-0 text-[13px] text-ink-muted" data-testid="progress-countdown-late">
        Taking a little longer than usual…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5" data-testid="progress-countdown">
      <p className="m-0 font-mono text-[15px] tabular-nums text-ink" aria-live="polite">
        {formatCountdown(remainingSeconds)}
      </p>
      <p className="m-0 text-[12px] text-ink-muted">{formatRangeLabel(props.estimate)}</p>
    </div>
  );
}
