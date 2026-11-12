"use client";

import {
  type MissingDocumentsSummary,
  missingDocumentChipCount,
  shouldShowMissingDocumentsBanner,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PRIMARY_BUTTON_CLASS } from "@/components/button-classes";
import { hiveDocumentsPath } from "@/lib/hive-routes";

const sessionKey = (hiveId: string) => `hive.missing-docs-banner.dismissed:${hiveId}`;

type MissingDocumentsBannerProps = {
  readonly hiveId: string;
  readonly summary: MissingDocumentsSummary;
  readonly onRebuild?: () => void;
  readonly rebuilding?: boolean;
};

export function MissingDocumentsBanner({ hiveId, summary, onRebuild, rebuilding = false }: MissingDocumentsBannerProps) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(sessionKey(hiveId)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [hiveId]);

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(sessionKey(hiveId), "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  }, [hiveId]);

  if (!shouldShowMissingDocumentsBanner(summary) || dismissed) return null;

  const missingCount = missingDocumentChipCount(summary);

  return (
    <div
      className="flex flex-col gap-3 rounded-card border border-coral/40 bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="missing-documents-banner"
    >
      {summary.hasPendingUploads && missingCount === 0 ? (
        <>
          <p className="m-0 text-body text-ink">New documents added — rebuild the study to include them</p>
          <div className="flex flex-wrap items-center gap-2">
            {onRebuild ? (
              <button type="button" className={PRIMARY_BUTTON_CLASS} data-action="rebuild-study" disabled={rebuilding} onClick={onRebuild}>
                {rebuilding ? "Rebuilding…" : "Rebuild study"}
              </button>
            ) : null}
            <button type="button" className="text-small text-quiet underline" onClick={dismiss}>
              Dismiss
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="m-0 text-body text-ink">
            {missingCount} {missingCount === 1 ? "document would help" : "documents would help"} complete this review — add
            them and rebuild the study{" "}
            <Link href={`${hiveDocumentsPath(hiveId)}#missing`} className="font-medium text-cell underline">
              on Documents
            </Link>
          </p>
          <button type="button" className="self-start text-small text-quiet underline sm:self-center" onClick={dismiss}>
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
