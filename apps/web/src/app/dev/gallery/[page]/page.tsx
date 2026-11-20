import { notFound } from "next/navigation";

import { isDevGalleryEnabled } from "@/dev/gallery/gallery-gate";
import {
  GalleryAudit,
  GalleryClientHome,
  GalleryClientHomeDone,
  GalleryComponents,
  GalleryDocuments,
  GalleryDocumentsEmpty,
  GalleryEvidenceItem,
  GalleryEvidenceStatement,
  GalleryEvidenceUnreadable,
  GalleryHomeFirmless,
  GalleryHomeLong,
  GalleryHomeNoStudy,
  GalleryHomeStaff,
  GalleryMyHives,
  GalleryNotes,
  GalleryOmniAnswer,
  GalleryOmniClientHandoff,
  GalleryOmniStaffClientQuestions,
  GalleryOmniStaffEmpty,
  GalleryOmniStaffResults,
  GalleryReport,
  GalleryShell,
} from "@/dev/gallery/views/GalleryUI2Bundle";

const PAGES = {
  components: GalleryComponents,
  shell: GalleryShell,
  "omni-staff-empty": GalleryOmniStaffEmpty,
  "omni-staff-results": GalleryOmniStaffResults,
  "omni-answer": GalleryOmniAnswer,
  "omni-client-handoff": GalleryOmniClientHandoff,
  "omni-staff-client-questions": GalleryOmniStaffClientQuestions,
  "home-staff": GalleryHomeStaff,
  "home-long": GalleryHomeLong,
  "home-firmless": GalleryHomeFirmless,
  "home-no-study": GalleryHomeNoStudy,
  "evidence-statement": GalleryEvidenceStatement,
  "evidence-item": GalleryEvidenceItem,
  "evidence-unreadable": GalleryEvidenceUnreadable,
  documents: GalleryDocuments,
  "documents-empty": GalleryDocumentsEmpty,
  "client-home": GalleryClientHome,
  "client-home-done": GalleryClientHomeDone,
  report: GalleryReport,
  audit: GalleryAudit,
  notes: GalleryNotes,
  "my-hives": GalleryMyHives,
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