"use client";

import {
  formatProgressEstimateRangeLabel,
  shouldReanchorProgressEstimate,
  type ProgressEstimate,
} from "@hiveforyou/contracts";
import { useEffect, useRef, useState } from "react";

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ProgressCountdown(props: { estimate: ProgressEstimate | null | undefined }) {
  const serverTargetMs = props.estimate ? Date.parse(props.estimate.estimatedCompletionAt) : null;
  const anchoredTargetMsRef = useRef<number | null>(null);
  if (serverTargetMs === null || !Number.isFinite(serverTargetMs)) {
    anchoredTargetMsRef.current = null;
  } else if (shouldReanchorProgressEstimate(anchoredTargetMsRef.current, serverTargetMs)) {
    anchoredTargetMsRef.current = serverTargetMs;
  }
  const targetMs = anchoredTargetMsRef.current;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!targetMs) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [targetMs]);

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
      <p className="m-0 text-[12px] text-ink-muted">
        {formatProgressEstimateRangeLabel(targetMs, nowMs)}
      </p>
    </div>
  );
}
