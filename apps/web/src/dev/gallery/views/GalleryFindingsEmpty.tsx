"use client";

import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { hiveDocumentsPath } from "@/lib/hive-routes";

import { GALLERY_HIVE_ID } from "../fixtures/board-messages";

import { GalleryFindingsLayout } from "./GalleryFindingsLayout";

export function GalleryFindingsEmpty() {
  return (
    <GalleryFindingsLayout titleSlug="findings-empty" toReviewCount={0} documentCount={0}>
      <div className="w-full max-w-col-read">
        <p className="m-0 text-body text-ink-2" data-testid="findings-empty-state">
          Your Study builds once documents are read.
        </p>
        <Link href={hiveDocumentsPath(GALLERY_HIVE_ID)} className="mt-3 inline-block">
          <Button variant="secondary" type="button">
            Go to Documents
          </Button>
        </Link>
      </div>
    </GalleryFindingsLayout>
  );
}