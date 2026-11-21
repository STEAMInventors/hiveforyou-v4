"use client";

import { galleryNoStudyHome } from "../gallery-home-props";

import { GalleryHomeShell } from "./GalleryHomeShell";

export function GalleryHomeNoStudy() {
  return <GalleryHomeShell titleSlug="home-no-study" props={galleryNoStudyHome()} />;
}
