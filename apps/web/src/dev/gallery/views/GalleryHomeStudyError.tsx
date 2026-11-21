"use client";

import { galleryStudyErrorHome } from "../gallery-home-props";

import { GalleryHomeShell } from "./GalleryHomeShell";

export function GalleryHomeStudyError() {
  return <GalleryHomeShell titleSlug="home-study-error" props={galleryStudyErrorHome()} />;
}
