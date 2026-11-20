import { notFound } from "next/navigation";

import { isDevGalleryEnabled } from "@/dev/gallery/gallery-gate";
import { GalleryBoardAsk } from "@/dev/gallery/views/GalleryBoardAsk";
import { GalleryBoardAskClient } from "@/dev/gallery/views/GalleryBoardAskClient";
import { GalleryBoardEmpty } from "@/dev/gallery/views/GalleryBoardEmpty";
import { GalleryBoardFirmless } from "@/dev/gallery/views/GalleryBoardFirmless";
import { GalleryBoardLong } from "@/dev/gallery/views/GalleryBoardLong";
import { GalleryBoardPeople } from "@/dev/gallery/views/GalleryBoardPeople";
import { GalleryComponents } from "@/dev/gallery/views/GalleryComponents";
import { GalleryFindingsEmpty } from "@/dev/gallery/views/GalleryFindingsEmpty";
import { GalleryFindingsLarge } from "@/dev/gallery/views/GalleryFindingsLarge";
import { GalleryFindingsMedicaid } from "@/dev/gallery/views/GalleryFindingsMedicaid";
import { GalleryShell } from "@/dev/gallery/views/GalleryShell";

const PAGES = {
  components: GalleryComponents,
  shell: GalleryShell,
  "board-people": GalleryBoardPeople,
  "board-ask": GalleryBoardAsk,
  "board-ask-client": GalleryBoardAskClient,
  "board-firmless": GalleryBoardFirmless,
  "board-empty": GalleryBoardEmpty,
  "board-long": GalleryBoardLong,
  "findings-medicaid": GalleryFindingsMedicaid,
  "findings-large": GalleryFindingsLarge,
  "findings-empty": GalleryFindingsEmpty,
} as const;

type GalleryPageKey = keyof typeof PAGES;

type Props = { params: Promise<{ page: string }> };

export default async function DevGalleryPage({ params }: Props) {
  if (!isDevGalleryEnabled()) notFound();
  const { page } = await params;
  const View = PAGES[page as GalleryPageKey];
  if (!View) notFound();
  return <View />;
}