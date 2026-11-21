"use client";

import type {
  CanonicalStudy,
  CoverageGap,
  FindingsOpenItem,
  FindingsTopic,
  GetStudyPreparationResponse,
  StudyView,
  StudyViewRow,
  StudyViewSources,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AskBar } from "@/components/hives/AskBar";
import { CanonicalStudyNotice } from "@/components/hives/CanonicalStudyNotice";
import { HiveStudyRebuildAction } from "@/components/hives/HiveStudyRebuildAction";
import { HiveConversation } from "@/components/hives/HiveConversation";
import { HiveHomeSidePanel } from "@/components/hives/HiveHomeSidePanel";
import type { ConversationLoad } from "@/components/hives/useHiveConversation";
import { FindingsCompareTable } from "@/components/findings/FindingsCompareTable";
import { FindingsTimelineList } from "@/components/findings/FindingsTimelineList";
import { EvidenceViewerProvider, useEvidenceViewer } from "@/components/study/EvidenceViewer";
import { buildHiveEvidenceViewerModel } from "@/components/study/hive-evidence-model";
import type { ChipRef } from "@/components/study/SourceChip";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { EMPTY_OMNI_CATALOG, useRegisterOmniCatalog } from "@/components/ui/omni-catalog";
import { ProgressMeter } from "@/components/ui/ProgressMeter";
import { Section } from "@/components/ui/Section";
import { ShowFewer, ShowMore } from "@/components/ui/ShowMore";
import { StateSentence } from "@/components/ui/StateSentence";
import { Statement, StatementTopic } from "@/components/ui/Statement";
import { StatusDot } from "@/components/ui/StatusDot";
import { Step } from "@/components/ui/Step";
import { WorkspaceLoadError } from "@/components/workspace/WorkspaceLoadError";
import { personFirstName } from "@/lib/hives/firm-board";
import type { StudyAvailability } from "@/lib/hives/study-availability";
import type { StudyLoadError } from "@/server/hives/hive-summary";
import { EVIDENCE_COMPOSE_PARAM } from "@/lib/hive-compose-query";
import { HIVE_CHAT_PANEL_MIN_WIDTH, useHiveChat, useMinWidth } from "@/lib/hive-chat-context";
import { EVIDENCE_SOURCE_PARAM } from "@/lib/evidence-source-query";
import { hiveDocumentsPath, hiveRequestedItemsPath } from "@/lib/hive-routes";
import {
  mergeOmniCatalog,
  omniOpenItemsFromFindings,
  omniStatementsFromTopics,
} from "@/lib/omni-catalog-build";

import { askSuggestions } from "./ask-suggestions";
import {
  findMissingRecordsTitle,
  missingRecordsDetail,
  missingRecordsTitle,
  requestComposerText,
  type HiveHomeContent,
} from "./home-model";

const STEP_LIMIT = 3;
const STATEMENT_LIMIT = 2;
const TIMELINE_LIMIT = 6;

const SECONDARY_LINK =
  "inline-flex h-[34px] items-center justify-center rounded-button border border-line-strong bg-paper px-[13px] text-[13.5px] font-semibold text-ink no-underline hover:bg-hover max-[759px]:h-11";

export type HiveHomeViewer = "staff" | "client" | "firmless";

export type HiveHomeProps = {
  hiveId: string;
  viewer: HiveHomeViewer;
  clientName: string | null;
  staffName: string | null;
  assistantName: string;
  content: HiveHomeContent | null;
  loadError: { message: string; correlationId: string; retryable: boolean } | null;
  studyLoadError: StudyLoadError | null;
  studyAvailability: StudyAvailability | null;
  initialPreparation?: GetStudyPreparationResponse;
  conflicts: readonly StudyViewRow[];
  timeline: readonly StudyViewRow[];
  view: StudyView | null;
  sources: StudyViewSources | null;
  canonicalStudy: CanonicalStudy | null;
  coverageGaps: readonly CoverageGap[];
  openItems: readonly FindingsOpenItem[];
  topics: readonly FindingsTopic[];
  documentPages?: Readonly<Record<string, number>>;
  initialPeople: ConversationLoad;
  currentUserId: string | null;
  staffView: boolean;
  viewerIsClient: boolean;
  hiveFirmId: string | null;
};

function stepDot(kind: "missing" | "difference" | "needs") {
  if (kind === "missing") return <StatusDot state="missing" label="Missing" />;
  if (kind === "difference") return <StatusDot state="changed" label="Changed" />;
  return <StatusDot state="needs" label="To review" />;
}

function LookAtIt({ chip, itemId }: { chip: ChipRef; itemId: string }) {
  const viewer = useEvidenceViewer();
  return (
    <Button
      variant="secondary"
      type="button"
      onClick={(event) => viewer.open(chip, event.currentTarget, { itemId })}
    >
      Look at it
    </Button>
  );
}

export function HiveHome(props: HiveHomeProps) {
  const evidence = useMemo(
    () =>
      buildHiveEvidenceViewerModel({
        view: props.view,
        sources: props.sources,
        canonicalStudy: props.canonicalStudy,
        coverageGaps: props.coverageGaps,
        documentPages: props.documentPages,
      }),
    [props.view, props.sources, props.canonicalStudy, props.coverageGaps, props.documentPages],
  );
  const pageCountFor = (id: string) => props.documentPages?.[id] ?? props.documentPages?.[id.toLowerCase()];
  const body = <HiveHomeBody {...props} />;
  if (!evidence) return body;
  return (
    <EvidenceViewerProvider
      hiveId={props.hiveId}
      labels={evidence.labels}
      chipLabels={evidence.chipLabels}
      pageCountFor={pageCountFor}
      citationContexts={evidence.citationContexts}
      view={props.view}
      sources={props.sources}
      canonicalStudy={props.canonicalStudy}
      openItems={props.openItems}
      topics={props.topics}
      coverageGaps={props.coverageGaps}
      clientFirstName={props.clientName?.trim() ? personFirstName(props.clientName) : null}
      staffOnFirmHive={props.staffView && props.hiveFirmId != null && !props.viewerIsClient}
    >
      {body}
    </EvidenceViewerProvider>
  );
}

function HiveHomeBody({
  hiveId,
  viewer,
  clientName,
  staffName,
  assistantName,
  content,
  loadError,
  studyLoadError,
  studyAvailability,
  initialPreparation,
  conflicts,
  timeline,
  openItems,
  topics,
  sources,
  initialPeople,
  currentUserId,
  staffView,
  viewerIsClient,
  hiveFirmId,
}: HiveHomeProps) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const [topicsOpen, setTopicsOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [fillDraft, setFillDraft] = useState<{ nonce: number; text: string } | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const text = searchParams.get(EVIDENCE_COMPOSE_PARAM)?.trim() ?? "";
    if (!text) return;
    setFillDraft({ nonce: Date.now(), text });
  }, [searchParams]);

  const clientFirst = clientName?.trim() ? personFirstName(clientName) : null;
  const staffFirst = staffName?.trim() ? personFirstName(staffName) : null;
  const other = viewerIsClient
    ? { first: staffFirst ?? "your team", full: staffName?.trim() || "your team", kind: "staff" as const }
    : { first: clientFirst ?? "the client", full: clientName?.trim() || "the client", kind: "client" as const };

  const showConversation = viewer !== "firmless";
  const staffBrief = viewer !== "client";
  const canonicalView = studyAvailability?.kind === "canonical";
  const olderStudy = studyAvailability?.kind === "older";

  const chat = useHiveChat();
  const wide = useMinWidth(HIVE_CHAT_PANEL_MIN_WIDTH);
  const askOn = Boolean(chat?.assistantOn);
  // Wide: the right column (tabs, or the chat alone on an own hive). Narrow: people under the brief + the Ask bar.
  const showPanel = showConversation || (askOn && wide);
  const showAskBar = askOn && !wide && viewer !== "client";
  const evidenceOpen = Boolean(searchParams.get(EVIDENCE_SOURCE_PARAM)?.trim());
  const omniCatalog = useMemo(
    () =>
      mergeOmniCatalog({
        suggestions: askOn
          ? askSuggestions({
              viewer: viewer === "firmless" ? "own" : "staff",
              toReview: content?.toReview ?? null,
              stillToCome: content?.stillToCome.length ?? null,
              documentsIn: content?.documentsIn ?? null,
            })
          : [],
        documents: EMPTY_OMNI_CATALOG.documents,
        statements: omniStatementsFromTopics(topics),
        openItems: content
          ? omniOpenItemsFromFindings(openItems, sources).concat(
              content.stillToCome.map((title, index) => ({
                id: `still-${index}`,
                title,
                kind: "missing" as const,
                ref: null,
              })),
            )
          : [],
      }),
    [askOn, content, openItems, sources, topics, viewer],
  );
  useRegisterOmniCatalog(omniCatalog, !evidenceOpen);

  const steps = useMemoSteps(content, clientFirst, viewer);
  const visibleSteps = stepsOpen ? steps : steps.slice(0, STEP_LIMIT);

  const people = showConversation ? (
    <HiveConversation
      hiveId={hiveId}
      initial={initialPeople}
      staffView={staffView}
      clientName={clientName}
      viewerIsClient={viewerIsClient}
      hiveFirmId={hiveFirmId}
      mode="people"
      assistantName={assistantName}
      teamMemberFirstName={staffFirst}
      currentUserId={currentUserId}
      column={{
        otherFirstName: other.first,
        otherFullName: other.full,
        otherKind: other.kind,
        assistantName,
      }}
      fillDraft={fillDraft}
    />
  ) : null;

  const conversation = showPanel ? (
    <HiveHomeSidePanel
      people={people}
      other={showConversation ? { first: other.first, full: other.full, kind: other.kind } : null}
      peopleDraftNonce={fillDraft?.nonce ?? null}
    />
  ) : null;

  return (
    <div
      data-testid="hive-home"
      className={
        showPanel
          ? "grid grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_400px] min-[1100px]:gap-12"
          : "mx-auto w-full max-w-col-read"
      }
    >
      <div className={`min-w-0 pt-8 ${showAskBar ? "pb-[120px]" : "pb-24"}`} data-testid="hive-home-brief">
        {loadError ? (
          <WorkspaceLoadError message={loadError.message} correlationId={loadError.correlationId} retryable={loadError.retryable} />
        ) : null}
        {content && !content.hasStudy ? (
          <div className="mt-2" data-testid="home-no-study">
            <p className="m-0 max-w-[640px] font-brand text-[20px] font-medium leading-[1.35] tracking-[-0.02em] text-ink">
              Your study builds once documents are read.
            </p>
            <Link href={hiveDocumentsPath(hiveId)} className={`${SECONDARY_LINK} mt-4`}>
              Go to Documents
            </Link>
          </div>
        ) : null}
        {content && content.hasStudy && staffBrief ? (
          <>
            <StateSentence
              documentsIn={content.documentsIn}
              checklistSize={content.checklistSize}
              toReview={content.toReview}
              stillToCome={content.stillToCome.length}
              lastWrote={viewer === "firmless" ? null : content.lastWrote}
            />
            {content.checklistSize != null ? (
              <ProgressMeter received={content.documentsIn} total={content.checklistSize} />
            ) : null}
            {studyLoadError ? (
              <div className="mt-4" data-testid="home-study-error">
                <WorkspaceLoadError
                  message={studyLoadError.message}
                  correlationId={studyLoadError.correlationId}
                  retryable={studyLoadError.retryable}
                />
              </div>
            ) : null}
            {olderStudy ? (
              <div className="mt-4 flex flex-col items-start gap-3" data-testid="home-older-study">
                <CanonicalStudyNotice />
                <HiveStudyRebuildAction hiveId={hiveId} initialPreparation={initialPreparation} focusDocuments />
              </div>
            ) : null}
            {content.study && canonicalView ? (
              <p className="m-0 mt-3 text-meta text-ink-3">
                Study v{content.study.revisionNumber}
                {content.study.acceptedLabel ? `, accepted ${content.study.acceptedLabel}` : ""} · every statement below
                opens the page it comes from
              </p>
            ) : null}
            {canonicalView ? (
              <Section title="Next steps" headingRight={steps.length} className="mt-10">
                <div data-testid="hive-next-steps">
                  {steps.length > 0 ? (
                    visibleSteps.map((step) => (
                    <Step
                      key={step.id}
                      status={step.dot}
                      title={step.title}
                      detail={step.detail}
                      action={
                        step.kind === "request" ? (
                          viewer === "firmless" ? (
                            <Link href={hiveRequestedItemsPath(hiveId)} className={SECONDARY_LINK}>
                              See the list
                            </Link>
                          ) : (
                            <Button
                              variant="secondary"
                              type="button"
                              onClick={() =>
                                setFillDraft({ nonce: Date.now(), text: requestComposerText(content.stillToCome) })
                              }
                            >
                              Write the request
                            </Button>
                          )
                        ) : step.ref ? (
                          <LookAtIt chip={step.ref} itemId={step.id} />
                        ) : null
                      }
                    />
                  ))
                  ) : (
                    <p className="m-0 py-3.5 text-body text-ink-2">Nothing is waiting on you.</p>
                  )}
                  {steps.length > STEP_LIMIT ? (
                    stepsOpen ? (
                      <ShowFewer label="Show fewer" onClick={() => setStepsOpen(false)} />
                    ) : (
                      <ShowMore label={`Show all ${steps.length}`} onClick={() => setStepsOpen(true)} />
                    )
                  ) : null}
                </div>
              </Section>
            ) : null}
            {canonicalView ? (
              <Section
                id="show"
                title="What the documents show"
                headingRight={
                  content.statementCount === 0
                    ? "0 statements"
                    : content.statementCount === 1
                      ? "1 statement"
                      : `${content.statementCount} statements`
                }
              >
                {content.statementCount === 0 ? (
                  <p className="m-0 py-3.5 text-body text-ink-2" data-testid="home-no-statements">
                    No statements in this study yet.
                  </p>
                ) : (
                content.topics.map((topic) => {
                  const open = topicsOpen.has(topic.id);
                  const rows = open ? topic.statements : topic.statements.slice(0, STATEMENT_LIMIT);
                  const hidden = topic.statements.length - STATEMENT_LIMIT;
                  return (
                    <StatementTopic key={topic.id} title={topic.title} uncertain={topic.uncertain}>
                      {rows.map((statement) => (
                        <Statement key={statement.id} body={statement.text} refs={statement.refs} />
                      ))}
                      {hidden > 0 ? (
                        open ? (
                          <ShowFewer
                            label="Show fewer"
                            onClick={() =>
                              setTopicsOpen((current) => {
                                const next = new Set(current);
                                next.delete(topic.id);
                                return next;
                              })
                            }
                          />
                        ) : (
                          <ShowMore
                            label={`${hidden} more`}
                            onClick={() => setTopicsOpen((current) => new Set(current).add(topic.id))}
                          />
                        )
                      ) : null}
                    </StatementTopic>
                  );
                })
                )}
              </Section>
            ) : null}
            {canonicalView ? (
              <SupportingDetail
                conflicts={conflicts}
                timeline={timeline}
                timelineOpen={timelineOpen}
                onToggleTimeline={() => setTimelineOpen((open) => !open)}
                coverage={content.coverage}
                calculations={content.calculations}
              />
            ) : null}
          </>
        ) : null}
      </div>
      {conversation}
      {showAskBar ? <AskBar /> : null}
    </div>
  );
}

type HomeStep = {
  id: string;
  kind: "request" | "item";
  title: string;
  detail: string;
  dot: ReactNode;
  ref: ChipRef | null;
};

function useMemoSteps(
  content: HiveHomeContent | null,
  clientFirst: string | null,
  viewer: HiveHomeViewer,
): HomeStep[] {
  return useMemo(() => {
    if (!content?.hasStudy) return [];
    const steps: HomeStep[] = [];
    if (content.stillToCome.length > 0) {
      steps.push({
        id: "missing-records",
        kind: "request",
        title:
          viewer === "firmless"
            ? findMissingRecordsTitle(content.stillToCome.length)
            : missingRecordsTitle(content.stillToCome.length, clientFirst),
        detail: missingRecordsDetail(content.stillToCome),
        dot: <StatusDot state="missing" label="Missing" />,
        ref: null,
      });
    }
    for (const item of content.reviewSteps) {
      steps.push({
        id: item.id,
        kind: "item",
        title: item.title,
        detail: item.detail,
        dot: stepDot(item.kind),
        ref: item.refs[0] ?? null,
      });
    }
    return steps;
  }, [clientFirst, content, viewer]);
}

function SupportingDetail({
  conflicts,
  timeline,
  timelineOpen,
  onToggleTimeline,
  coverage,
  calculations,
}: {
  conflicts: readonly StudyViewRow[];
  timeline: readonly StudyViewRow[];
  timelineOpen: boolean;
  onToggleTimeline: () => void;
  coverage: HiveHomeContent["coverage"];
  calculations: HiveHomeContent["calculations"];
}) {
  const visibleTimeline = timelineOpen ? timeline : timeline.slice(0, TIMELINE_LIMIT);
  const hasAny = conflicts.length > 0 || timeline.length > 0 || coverage.length > 0 || calculations.length > 0;
  if (!hasAny) return null;
  return (
    <div className="mt-10">
      {conflicts.length > 0 ? (
        <Disclosure title="Compare across documents">
          <FindingsCompareTable rows={conflicts} />
        </Disclosure>
      ) : null}
      {timeline.length > 0 ? (
        <Disclosure title="Events in date order">
          <FindingsTimelineList rows={visibleTimeline} />
          {timeline.length > TIMELINE_LIMIT ? (
            timelineOpen ? (
              <ShowFewer label="Show fewer" onClick={onToggleTimeline} />
            ) : (
              <ShowMore label={`Show all ${timeline.length}`} onClick={onToggleTimeline} />
            )
          ) : null}
        </Disclosure>
      ) : null}
      {coverage.length > 0 ? (
        <Disclosure title="Document coverage">
          <ul className="m-0 list-none p-0">
            {coverage.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 border-b border-line py-3">
                <span className="text-body text-ink">{row.label}</span>
                {row.state ? <StatusDot state={row.state} /> : null}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
      {calculations.length > 0 ? (
        <Disclosure title="How the totals are calculated">
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {calculations.map((line) => (
              <li key={line.id}>
                <p className="m-0 text-body font-semibold text-ink">{line.label}</p>
                <p className="m-0 mt-0.5 text-[13.5px] text-ink-2">{line.detail}</p>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}
