"use client";

import { FindingsPageView } from "@/components/findings/FindingsPageView";

import { LARGE_FINDINGS } from "../fixtures/findings-gallery";

import { GalleryFindingsLayout } from "./GalleryFindingsLayout";

export function GalleryFindingsLarge() {
  return (
    <GalleryFindingsLayout
      titleSlug="findings-large"
      hiveName="Large sample hive"
      toReviewCount={LARGE_FINDINGS.openItemCount}
      documentCount={9}
    >
      <FindingsPageView {...LARGE_FINDINGS} />
    </GalleryFindingsLayout>
  );
}