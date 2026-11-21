"use client";

import { ClientHome } from "@/components/home/ClientHome";

import { galleryClientOlderStudyClientHome } from "../gallery-home-props";
import { GalleryHiveChrome } from "../gallery-hive-chrome";

export function GalleryClientHomeOlderStudy() {
  const props = galleryClientOlderStudyClientHome();

  return (
    <GalleryHiveChrome
      titleSlug="client-home-older-study"
      clientViewer
      account={{ initials: "DE", displayName: "Dana Ellis", email: "dana@example.com", startingView: "own" }}
    >
      <ClientHome {...props} />
    </GalleryHiveChrome>
  );
}