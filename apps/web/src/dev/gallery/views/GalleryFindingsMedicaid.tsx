"use client";

import { FindingsPageView } from "@/components/findings/FindingsPageView";

import { MEDICAID_FINDINGS } from "../fixtures/findings-gallery";

import { GalleryFindingsLayout } from "./GalleryFindingsLayout";

export function GalleryFindingsMedicaid() {
  return (
    <GalleryFindingsLayout titleSlug="findings-medicaid" toReviewCount={8} documentCount={9}>
      <FindingsPageView {...MEDICAID_FINDINGS} />
    </GalleryFindingsLayout>
  );
}