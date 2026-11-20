"use client";

import Link from "next/link";
import { Suspense, useEffect, useId, type ReactNode } from "react";

import { FrontExample } from "@/components/FrontExample";
import { FrontStartButton } from "@/components/FrontStartButton";
import { HiveMarkGraphic } from "@/components/HiveMarkGraphic";
import { LandingStart } from "@/components/LandingStart";
import { SignedOutBar } from "@/components/SignedOutBar";
import { PRIMARY_BUTTON_CLASS, QUIET_LINK_CLASS, SIGNED_OUT_SIGN_IN_CLASS } from "@/components/button-classes";
import { SignInFlow } from "@/components/auth/SignInFlow";
import { SignInField, SignInHeading, SignInShell } from "@/components/auth/SignInShell";
import { AppShell } from "@/components/app-header";
import { HiveHome } from "@/components/home/HiveHome";
import { ClientHome } from "@/components/home/ClientHome";
import { MyHivesPanel } from "@/components/hives/MyHivesPanel";
import { ClientsHomeProvider } from "@/lib/hives/clients-home-context";
import { FRONT_EXAMPLE, FRONT_PAGE_COPY, coveredAreasParagraph } from "@/content/front-page";

import { GalleryHiveChrome, useGalleryTitle } from "../gallery-hive-chrome";
import { galleryStaffHome } from "../gallery-home-props";
import {
  GALLERY_ASSISTANT_NAME,
  GALLERY_ASK_CLIENT_PAGE,
  GALLERY_ASK_EMPTY_PAGE,
  GALLERY_ASK_STAFF_PAGE,
  GALLERY_ASK_STAFF_READONLY_PAGE,
  GALLERY_CLIENT_ID,
  GALLERY_HIVE,
  GALLERY_HIVE_ID,
  GALLERY_PEOPLE_CLIENT_PAGE,
  GALLERY_PEOPLE_PAGE,
  GALLERY_STAFF_ID,
} from "../fixtures/board-messages";
import { MEDICAID_FINDINGS } from "../fixtures/findings-gallery";
import {
  GALLERY_FIRM_HIVES,
  GALLERY_FIRM_SUMMARIES,
  GALLERY_OWN_HIVES,
  GALLERY_OWN_SUMMARIES,
} from "../fixtures/hives-list-gallery";
import { GalleryFrame } from "./GalleryFrame";

const SECTION_TITLE =
  "m-0 font-brand text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink min-[760px]:text-[30px]";
const WRAP = "mx-auto w-full max-w-[1120px] px-4 min-[760px]:px-6";
const COVERS = coveredAreasParagraph(["Example intake review", "Example records review"]);

const FIRM_ACCOUNT = {
  initials: "PS",
  displayName: "Priya Shah",
  email: "priya@example.com",
  startingView: "clients" as const,
  firmName: "Example firm",
};

const OWN_ACCOUNT = {
  initials: "DE",
  displayName: "Dana Ellis",
  email: "dana@example.com",
  startingView: "own" as const,
};

function GalleryQuerySync({ query }: { query: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    const incoming = new URLSearchParams(query);
    for (const [key, value] of incoming.entries()) {
      url.searchParams.set(key, value);
    }
    window.history.replaceState(null, "", url.toString());
  }, [query]);
  return null;
}

function GalleryClickOnMount({ testId }: { testId: string }) {
  useEffect(() => {
    const node = document.querySelector(`[data-testid="${testId}"]`);
    if (node instanceof HTMLElement) {
      node.click();
    }
  }, [testId]);
  return null;
}

function GalleryReadClientQuestions() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const row = document.querySelector('[data-testid="ask-client-questions-row"]');
      const button = row?.querySelector("button");
      if (button instanceof HTMLElement) button.click();
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

function GalleryHivesShell({
  titleSlug,
  children,
  account = FIRM_ACCOUNT,
  initialQuery = "",
}: {
  titleSlug: string;
  children: ReactNode;
  account?: typeof FIRM_ACCOUNT | typeof OWN_ACCOUNT;
  initialQuery?: string;
}) {
  useGalleryTitle(titleSlug);
  return (
    <GalleryFrame>
      <ClientsHomeProvider enabled initialQuery={initialQuery}>
        <AppShell account={account}>
          <Suspense fallback={null}>{children}</Suspense>
        </AppShell>
      </ClientsHomeProvider>
    </GalleryFrame>
  );
}

function LandingPageSections({ example }: { example?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <SignedOutBar>
        <Link href="/sign-in" className={SIGNED_OUT_SIGN_IN_CLASS}>
          {FRONT_PAGE_COPY.signIn}
        </Link>
      </SignedOutBar>
      <main className="flex flex-1 flex-col">
        <section
          aria-labelledby="front-title"
          className="mx-auto flex w-full max-w-[720px] flex-col items-center px-4 pb-16 pt-12 text-center min-[760px]:px-6 min-[760px]:pb-[88px] min-[760px]:pt-[72px]"
        >
          <HiveMarkGraphic animate heightPx={64} />
          <h1
            id="front-title"
            className="m-0 mt-6 font-brand text-[clamp(34px,5.4vw,52px)] font-semibold leading-[1.08] tracking-[-0.03em] text-ink"
          >
            {FRONT_PAGE_COPY.heroTitle}
          </h1>
          <p className="m-0 mt-4 max-w-[560px] text-[17px] leading-[1.55] text-ink-2">{FRONT_PAGE_COPY.heroLede}</p>
          <Suspense fallback={null}>
            <LandingStart />
          </Suspense>
        </section>

        <section aria-labelledby="front-example-title" className="bg-mist py-[72px]">
          <div className={WRAP}>
            <h2 id="front-example-title" className={SECTION_TITLE}>
              {FRONT_PAGE_COPY.exampleTitle}
            </h2>
            <p className="m-0 mt-2 text-[15px] text-ink-2">{FRONT_PAGE_COPY.exampleSub}</p>
            {example ?? <FrontExample example={FRONT_EXAMPLE} />}
          </div>
        </section>

        <section aria-labelledby="front-how-title" className="pt-20">
          <div className={WRAP}>
            <h2 id="front-how-title" className={SECTION_TITLE}>
              {FRONT_PAGE_COPY.howTitle}
            </h2>
            <div className="mt-6 grid gap-x-10 gap-y-8 min-[760px]:grid-cols-3">
              {FRONT_PAGE_COPY.how.map((step) => (
                <div key={step.title} className="border-t border-ink pt-4">
                  <h3 className="m-0 font-brand text-[19px] font-semibold tracking-[-0.01em] text-ink">{step.title}</h3>
                  <p className="m-0 mt-2 text-[15px] leading-[1.55] text-ink-2">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="front-who-title" className="pt-20">
          <div className={WRAP}>
            <h2 id="front-who-title" className={SECTION_TITLE}>
              {FRONT_PAGE_COPY.whoTitle}
            </h2>
            <div className="mt-5 border-t border-ink">
              {FRONT_PAGE_COPY.who.map((row) => (
                <div
                  key={row.label}
                  className="grid gap-x-6 gap-y-1 border-b border-line py-4 text-[15px] min-[760px]:grid-cols-[200px_minmax(0,1fr)]"
                >
                  <b className="font-semibold text-ink">{row.label}</b>
                  <p className="m-0 text-ink-2">{row.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {COVERS ? (
          <section aria-labelledby="front-covers-title" className="pt-20">
            <div className={WRAP}>
              <h2 id="front-covers-title" className={SECTION_TITLE}>
                {FRONT_PAGE_COPY.coversTitle}
              </h2>
              <p className="m-0 mt-3 max-w-[640px] text-[16px] leading-[1.6] text-ink-2">{COVERS}</p>
            </div>
          </section>
        ) : null}

        <section className="pb-[72px] pt-24">
          <div className={WRAP}>
            <div className="flex flex-wrap items-center justify-between gap-6 border-t border-line pt-10">
              <div className="flex items-center gap-3.5 font-brand text-[26px] font-semibold tracking-[-0.02em] text-ink">
                <HiveMarkGraphic heightPx={40} />
                <span>{FRONT_PAGE_COPY.slogan}</span>
              </div>
              <FrontStartButton label={FRONT_PAGE_COPY.startAHive} />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${WRAP} flex flex-wrap justify-between gap-3 py-6 text-[13px] text-ink-3`}>
          <span>© {new Date().getFullYear()} HiveForYou</span>
          <span>{FRONT_PAGE_COPY.disclaimer}</span>
        </div>
      </footer>
    </div>
  );
}

function GallerySignInCodeStep() {
  const codeId = useId();
  const email = "priya@example.com";
  return (
    <SignInShell>
      <SignInHeading
        title="Check your email"
        lede={
          <>
            We sent a sign-in code to <b className="font-semibold text-ink">{email}</b>. Enter it below.
          </>
        }
      />
      <form className="flex flex-col gap-4" onSubmit={(event) => event.preventDefault()}>
        <SignInField
          id={codeId}
          label="Code from the email"
          name="token"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          defaultValue="123456"
          required
          inputClassName="tracking-[0.3em] tabular-nums"
        />
        <button type="submit" className={`${PRIMARY_BUTTON_CLASS} w-full`}>
          Sign in
        </button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <button type="button" className={QUIET_LINK_CLASS}>
          Use a different email
        </button>
        <button type="button" className={QUIET_LINK_CLASS}>
          Send a new code
        </button>
      </div>
      <p className="m-0 flex items-start gap-2 text-[13px] leading-[1.5] text-ink-3">
        <span>No password to remember. Each hive is visible only to the people invited to it.</span>
      </p>
    </SignInShell>
  );
}

const CLIENT_CHECKLIST = [
  {
    gapId: "g1",
    title: "Checking statements Apr–Jun 2023",
    status: "not_in" as const,
    statusText: "Not in yet",
    action: { kind: "link" as const, label: "Add it", href: "#" },
  },
];

function medicaidDocuments() {
  return (MEDICAID_FINDINGS.canonicalStudy?.documents ?? []).map((document, index) => ({
    sourceDocumentId: document.sourceDocumentId,
    id: document.sourceDocumentId,
    hiveId: GALLERY_HIVE_ID,
    clientRequestId: GALLERY_HIVE.clientRequestId,
    fileName: `statement-${index + 1}.pdf`,
    mimeType: "application/pdf",
    byteSize: 204800,
    sha256: `sha256:${"a".repeat(64)}`,
    storageBucket: "hive-source-documents",
    storagePath: `owner/gallery/${index}.pdf`,
    status: "ACTIVE",
    failureReason: null,
    lifecycleStatus: "ACTIVE",
    uploadStatus: "UPLOADED",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ownerUserId: GALLERY_CLIENT_ID,
    role: document.role,
    typeInPlainWords: document.typeInPlainWords,
    unreadablePageCount: 0,
    pageCount: MEDICAID_FINDINGS.documentPages?.[document.sourceDocumentId] ?? 12,
    readPercent: 100,
    duplicateOfSourceDocumentId: null,
    coverageStatus: "INCLUDED",
    readStatus: "READ",
    registeredAt: "2026-10-01T00:00:00.000Z",
    scanStatus: "UNKNOWN_TO_SCANNER",
  }));
}

export function GalleryFront() {
  useGalleryTitle("front");
  return <LandingPageSections />;
}

export function GalleryFrontSelf() {
  useGalleryTitle("front-self");
  return (
    <>
      <GalleryQuerySync query="for=self" />
      <LandingPageSections />
    </>
  );
}

export function GalleryFrontExample2() {
  useGalleryTitle("front-example-2");
  return <LandingPageSections example={<FrontExample example={FRONT_EXAMPLE} initialSelectedIndex={2} />} />;
}

export function GallerySignInEmail() {
  useGalleryTitle("sign-in-email");
  return (
    <GalleryFrame>
      <SignInFlow nextPath="/hives" startClients={false} createAccount={false} />
    </GalleryFrame>
  );
}

export function GallerySignInPrefill() {
  useGalleryTitle("sign-in-prefill");
  return (
    <GalleryFrame>
      <SignInFlow
        nextPath="/hives"
        startClients
        createAccount
        prefillEmail="Dana@Firm.example"
      />
    </GalleryFrame>
  );
}

export function GallerySignInCode() {
  useGalleryTitle("sign-in-code");
  return (
    <GalleryFrame>
      <GallerySignInCodeStep />
    </GalleryFrame>
  );
}

export function GallerySignInError() {
  useGalleryTitle("sign-in-error");
  return (
    <GalleryFrame>
      <SignInFlow
        nextPath="/hives"
        startClients={false}
        createAccount={false}
        linkError="That sign-in link has expired. Request a new code."
      />
    </GalleryFrame>
  );
}

export function GalleryHivesFirm() {
  return (
    <GalleryHivesShell titleSlug="hives-firm">
      <MyHivesPanel
        initialHives={GALLERY_FIRM_HIVES}
        summaries={GALLERY_FIRM_SUMMARIES}
        startingView="clients"
        showFirmRail
        viewerUserId={GALLERY_STAFF_ID}
      />
    </GalleryHivesShell>
  );
}

export function GalleryHivesMine() {
  return (
    <GalleryHivesShell titleSlug="hives-mine">
      <GalleryQuerySync query="queue=mine" />
      <MyHivesPanel
        initialHives={GALLERY_FIRM_HIVES}
        summaries={GALLERY_FIRM_SUMMARIES}
        startingView="clients"
        showFirmRail
        viewerUserId={GALLERY_STAFF_ID}
      />
    </GalleryHivesShell>
  );
}

export function GalleryHivesFindNone() {
  return (
    <GalleryHivesShell titleSlug="hives-find-none" initialQuery="Zelda">
      <MyHivesPanel
        initialHives={GALLERY_FIRM_HIVES}
        summaries={GALLERY_FIRM_SUMMARIES}
        startingView="clients"
        showFirmRail
        viewerUserId={GALLERY_STAFF_ID}
      />
    </GalleryHivesShell>
  );
}

export function GalleryHivesFirstVisit() {
  return (
    <GalleryHivesShell titleSlug="hives-first-visit">
      <MyHivesPanel initialHives={[]} summaries={{}} startingView="clients" showFirmRail viewerUserId={GALLERY_STAFF_ID} />
    </GalleryHivesShell>
  );
}

export function GalleryHivesOwn() {
  return (
    <GalleryHivesShell titleSlug="hives-own" account={OWN_ACCOUNT}>
      <MyHivesPanel
        initialHives={GALLERY_OWN_HIVES}
        summaries={GALLERY_OWN_SUMMARIES}
        startingView="own"
        viewerUserId={GALLERY_CLIENT_ID}
      />
    </GalleryHivesShell>
  );
}

export function GalleryHivesError() {
  return (
    <GalleryHivesShell titleSlug="hives-error">
      <MyHivesPanel
        initialHives={[]}
        initialError={{ message: "Could not load your hives.", correlationId: "abcd1234-0000-4000-8000-000000000000" }}
        summaries={{}}
        startingView="clients"
        showFirmRail
        viewerUserId={GALLERY_STAFF_ID}
      />
    </GalleryHivesShell>
  );
}

export function GalleryHomeStaffChat() {
  return (
    <GalleryHiveChrome titleSlug="home-staff-chat" assistantPage={GALLERY_ASK_STAFF_PAGE}>
      <HiveHome {...galleryStaffHome()} />
    </GalleryHiveChrome>
  );
}

export function GalleryHomeStaffPeople() {
  return (
    <GalleryHiveChrome titleSlug="home-staff-people">
      <GalleryQuerySync query="side=people" />
      <HiveHome {...galleryStaffHome()} />
    </GalleryHiveChrome>
  );
}

export function GalleryHomeStaffClientQuestions() {
  return (
    <GalleryHiveChrome
      titleSlug="home-staff-client-questions"
      assistantPage={GALLERY_ASK_STAFF_READONLY_PAGE}
      initialClientAssistant={{ ok: true, page: GALLERY_ASK_CLIENT_PAGE }}
    >
      <GalleryReadClientQuestions />
      <HiveHome {...galleryStaffHome()} />
    </GalleryHiveChrome>
  );
}

export function GalleryHomeNarrowAskbar() {
  return (
    <GalleryHiveChrome titleSlug="home-narrow-askbar" assistantPage={GALLERY_ASK_EMPTY_PAGE}>
      <HiveHome {...galleryStaffHome()} />
    </GalleryHiveChrome>
  );
}

export function GalleryChatSheetClient() {
  return (
    <GalleryHiveChrome
      titleSlug="chat-sheet-client"
      clientViewer
      assistantPage={GALLERY_ASK_CLIENT_PAGE}
      account={OWN_ACCOUNT}
    >
      <GalleryClickOnMount testId="client-home-ask" />
      <ClientHome
        hiveId={GALLERY_HIVE_ID}
        hiveTitle={GALLERY_HIVE.name}
        staffDisplayName="Priya Shah"
        staffTitle="Onboarding associate"
        assistantName={GALLERY_ASSISTANT_NAME}
        checklist={CLIENT_CHECKLIST}
        progress={{ in: 6, total: 9 }}
        openItems={MEDICAID_FINDINGS.otherOpenItems}
        initialDocuments={medicaidDocuments() as never}
        acceptedStudyRevisionId="rev-gallery"
        initialPeople={{ ok: true, page: GALLERY_PEOPLE_CLIENT_PAGE }}
        currentUserId={GALLERY_CLIENT_ID}
        hiveFirmId={GALLERY_HIVE.firmId ?? null}
        loadError={null}
        view={MEDICAID_FINDINGS.view}
        sources={MEDICAID_FINDINGS.sources}
        canonicalStudy={MEDICAID_FINDINGS.canonicalStudy}
        coverageGaps={MEDICAID_FINDINGS.coverageGaps}
        topics={MEDICAID_FINDINGS.topics}
        documentPages={MEDICAID_FINDINGS.documentPages}
      />
    </GalleryHiveChrome>
  );
}

function EvidenceAskGallery() {
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("source", "f1@m1:1");
    window.history.replaceState(null, "", url.toString());
  }, []);

  useEffect(() => {
    const openTimer = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-testid="source-ref"]')?.click();
    }, 700);
    const askTimer = window.setTimeout(() => {
      document.querySelector<HTMLElement>('[data-testid="evidence-ask-assistant"]')?.click();
    }, 1300);
    return () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(askTimer);
    };
  }, []);

  return (
    <GalleryHiveChrome titleSlug="evidence-ask-page">
      <HiveHome {...galleryStaffHome()} />
    </GalleryHiveChrome>
  );
}

export function GalleryEvidenceAskPage() {
  return <EvidenceAskGallery />;
}

export function GalleryHomeAssistantOff() {
  return (
    <GalleryHiveChrome titleSlug="home-assistant-off" assistantRepliesOn={false}>
      <HiveHome {...galleryStaffHome()} />
    </GalleryHiveChrome>
  );
}