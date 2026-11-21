"use client";

import { HiveHome } from "@/components/home/HiveHome";

import { GalleryHiveChrome } from "../gallery-hive-chrome";
import { galleryOlderStudyHome } from "../gallery-home-props";

export function GalleryHomeOlderStudy() {
  return (
    <GalleryHiveChrome titleSlug="home-older-study">
      <HiveHome {...galleryOlderStudyHome()} />
    </GalleryHiveChrome>
  );
}