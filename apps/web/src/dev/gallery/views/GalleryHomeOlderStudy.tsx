"use client";

import { galleryOlderStudyHome } from "../gallery-home-props";

import { GalleryHomeShell } from "./GalleryHomeShell";

export function GalleryHomeOlderStudy() {
  return <GalleryHomeShell titleSlug="home-older-study" props={galleryOlderStudyHome()} />;
}