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
import {
  GalleryChatSheetClient,
  GalleryEvidenceAskPage,
  GalleryFront,
  GalleryFrontExample2,
  GalleryFrontSelf,
  GalleryHivesError,
  GalleryHivesFindNone,
  GalleryHivesFirm,
  GalleryHivesFirstVisit,
  GalleryHivesMine,
  GalleryHivesOwn,
  GalleryHomeAssistantOff,
  GalleryHomeNarrowAskbar,
  GalleryHomeStaffChat,
  GalleryHomeStaffClientQuestions,
  GalleryHomeStaffPeople,
  GallerySignInCode,
  GallerySignInEmail,
  GallerySignInError,
  GallerySignInPrefill,
} from "@/dev/gallery/views/GalleryUI3Bundle";
import { GalleryClientHomeOlderStudy } from "@/dev/gallery/views/GalleryClientHomeOlderStudy";
import { GalleryPersonalBoard } from "@/dev/gallery/views/GalleryPersonalBoard";
import { GalleryHivesFirmMenu } from "@/dev/gallery/views/GalleryHivesFirmMenu";
import { GalleryHomeOlderStudy } from "@/dev/gallery/views/GalleryHomeOlderStudy";
import { GalleryHomeStudyError } from "@/dev/gallery/views/GalleryHomeStudyError";

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
  front: GalleryFront,
  "front-self": GalleryFrontSelf,
  "front-example-2": GalleryFrontExample2,
  "sign-in-email": GallerySignInEmail,
  "sign-in-prefill": GallerySignInPrefill,
  "sign-in-code": GallerySignInCode,
  "sign-in-error": GallerySignInError,
  "hives-firm": GalleryHivesFirm,
  "hives-mine": GalleryHivesMine,
  "hives-find-none": GalleryHivesFindNone,
  "hives-first-visit": GalleryHivesFirstVisit,
  "hives-own": GalleryHivesOwn,
  "hives-error": GalleryHivesError,
  "home-staff-chat": GalleryHomeStaffChat,
  "home-staff-people": GalleryHomeStaffPeople,
  "home-staff-client-questions": GalleryHomeStaffClientQuestions,
  "home-narrow-askbar": GalleryHomeNarrowAskbar,
  "chat-sheet-client": GalleryChatSheetClient,
  "evidence-ask-page": GalleryEvidenceAskPage,
  "home-assistant-off": GalleryHomeAssistantOff,
  "home-older-study": GalleryHomeOlderStudy,
  "home-study-error": GalleryHomeStudyError,
  "client-home-older-study": GalleryClientHomeOlderStudy,
  "hives-firm-menu": GalleryHivesFirmMenu,
  "personal-board": GalleryPersonalBoard,
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