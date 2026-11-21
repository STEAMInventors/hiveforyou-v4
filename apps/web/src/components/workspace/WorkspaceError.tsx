"use client";

import { useState } from "react";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";

import { Card } from "./Card";

export type WorkspaceErrorProps = {
  message: string;
  correlationId?: string | null;
  errorDigest?: string | null;
  retryable?: boolean;
  onRetry?: () => void;
};

function referenceSnippet(correlationId: string): string {
  return correlationId.slice(0, 8);
}

export function WorkspaceError({
  message,
  correlationId = null,
  errorDigest = null,
  retryable = false,
  onRetry,
}: WorkspaceErrorProps) {
  const [copied, setCopied] = useState(false);
  const refText = correlationId ? referenceSnippet(correlationId) : null;

  return (
    <Card testId="workspace-error">
      <p role="alert" className="m-0 text-small text-ink">
        {message}
      </p>
      {refText ? (
        <p className="m-0 mt-3 flex flex-wrap items-center gap-2 text-caption text-ink-2">
          <span>
            Reference <span className="font-mono text-ink">{refText}</span>
          </span>
          {correlationId ? (
            <button
              type="button"
              className="min-h-11 rounded-control border border-line bg-paper px-3 text-caption font-medium text-ink hover:bg-mist"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(correlationId);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* ignore */
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
        </p>
      ) : errorDigest ? (
        <p className="m-0 mt-3 text-caption text-ink-2">
          Error code <span className="font-mono text-ink">{errorDigest}</span>
        </p>
      ) : null}
      {retryable && onRetry ? (
        <div className="mt-4">
          <button type="button" className={WORKSPACE_SECONDARY} onClick={() => onRetry()}>
            Try again
          </button>
        </div>
      ) : null}
    </Card>
  );
}