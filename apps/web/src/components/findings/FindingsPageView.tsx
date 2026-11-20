"use client";

import type {
  CanonicalStudy,
  CoverageGap,
  FindingsChainEvidenceSection,
  FindingsGlanceMetric,
  FindingsOpenItem,
  FindingsOpenItemKind,
  FindingsTopic,
  GetStudyPreparationResponse,
  Pack,
  StudyView,
  StudyViewSources,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { GlanceRow, type GlanceEntry } from "@/components/ui/GlanceRow";
import { ItemRow } from "@/components/ui/ItemRow";
import { MetaDot, MetaLine } from "@/components/ui/MetaLine";
import { Section } from "@/components/ui/Section";
import { Segmented } from "@/components/ui/Segmented";
import { ShowFewer, ShowMore } from "@/components/ui/ShowMore";
import { Statement, StatementTopic } from "@/components/ui/Statement";
import type { ChipRef } from "@/components/study/SourceChip";
import { EvidenceViewerProvider } from "@/components/study/EvidenceViewer";
import { groupMissing } from "@/components/study/MissingList";
import { MissingStudyItems } from "@/components/study/MissingStudyItems";
import { buildHiveEvidenceViewerModel } from "@/components/study/hive-evidence-model";
import { ReadProblemNotice, readProblemsFromCoverage } from "@/components/study/ReadProblemNotice";
import type { DisplayState } from "@/components/study/status-state";
import { hiveBoardPath, hiveDocumentsPath } from "@/lib/hive-routes";
import { FindingsReviewDrawer } from "@/components/findings/FindingsReviewDrawer";
import { DOCUMENT_REQUEST_LIST_COMPONENT, documentRequestListHasContent } from "@hiveforyou/contracts";

import { FindingsChainEvidenceBlock, FindingsCompareTable } from "./FindingsCompareTable";
import { FindingsFindBar, FindingsOnThisPage, useFindingsScrollSpy, type FindingsTocEntry } from "./FindingsPageToc";
import { FindingsTimelineList } from "./FindingsTimelineList";

type FindingsPageViewProps = {
  hiveId: string;
  revisionNumber: number;
  acceptedAt?: string | null;
  assistantName?: string;
  view: StudyView;
  sources: StudyViewSources | null;
  canonicalStudy: CanonicalStudy | null;
  pack: Pack | null;
  topics: FindingsTopic[];
  otherOpenItems: FindingsOpenItem[];
  glanceMetrics: FindingsGlanceMetric[];
  chainEvidence: readonly FindingsChainEvidenceSection[];
  openItemCount: number;
  coverageGaps: readonly CoverageGap[];
  documentPages?: Readonly<Record<string, number>>;
  preparation: GetStudyPreparationResponse | null;
};

const LIMIT_ITEMS = 5;
const LIMIT_STATEMENTS = 3;
const LIMIT_TIMELINE = 6;
const FIND_BAR_THRESHOLD = 30;

const SECTION_REVIEW = "findings-review";
const SECTION_TOPICS = "findings-topics";
const SECTION_MORE = "findings-more";

type KindFilter = "all" | FindingsOpenItemKind;

function openItemState(kind: FindingsOpenItemKind): DisplayState {
  if (kind === "missing") return "missing";
  if (kind === "difference") return "changed";
  return "needs";
}

function formatAcceptedDay(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
}

function matchesFilter(needle: string, parts: readonly (string | null | undefined)[]): boolean {
  const q = needle.trim().toLowerCase();
  if (q === "") return true;
  return parts.some((part) => (part ?? "").toLowerCase().includes(q));
}

function itemRefs(item: FindingsOpenItem, sources: StudyViewSources | null): ChipRef[] {
  if (item.factIds.length === 0) return [];
  return item.factIds.flatMap((factId) => {
    const ref = sources?.facts[factId];
    return ref
      ? [
          {
            sourceDocumentId: ref.sourceDocumentId,
            pageNumber: ref.pageNumber,
            quote: ref.quote,
            factIds: [factId],
          },
        ]
      : [];
  });
}

function statementRefs(statement: FindingsTopic["statements"][number]): ChipRef[] {
  return statement.values.map((value) => ({
    sourceDocumentId: value.sourceRef.sourceDocumentId,
    pageNumber: value.sourceRef.pageNumber,
    quote: value.sourceRef.quote,
    factIds: [value.factId],
  }));
}

function roleTexts(refs: readonly ChipRef[], roleFor: (id: string) => string): string[] {
  return [...new Set(refs.map((ref) => roleFor(ref.sourceDocumentId)))];
}

export function FindingsPageView({
  hiveId,
  revisionNumber,
  acceptedAt = null,
  assistantName = "HiveForYou",
  view,
  sources,
  canonicalStudy,
  topics,
  otherOpenItems,
  glanceMetrics,
  chainEvidence,
  openItemCount,
  coverageGaps,
  documentPages,
  preparation,
  pack,
}: FindingsPageViewProps) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [calculationId, setCalculationId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [findQuery, setFindQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const reviewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pageCountFor = (id: string) => documentPages?.[id] ?? documentPages?.[id.toLowerCase()];

  const openReview = useCallback((itemId: string, trigger: HTMLButtonElement) => {
    reviewTriggerRef.current = trigger;
    setReviewId(itemId);
  }, []);

  const closeReview = useCallback(() => {
    const trigger = reviewTriggerRef.current;
    setReviewId(null);
    requestAnimationFrame(() => {
      trigger?.focus();
    });
  }, []);

  const model = useMemo(() => {
    const documents = view.blocks.find((block) => block.name === "documents")?.rows ?? [];
    const typeByDoc = new Map(
      documents.map((row) => [row.id.toLowerCase(), row.typeInPlainWords?.trim() || null] as const),
    );
    if (canonicalStudy) {
      for (const document of canonicalStudy.documents) {
        const key = document.sourceDocumentId.toLowerCase();
        if (!typeByDoc.get(key)) typeByDoc.set(key, document.typeInPlainWords.trim() || null);
      }
    }
    const evidence = buildHiveEvidenceViewerModel({
      view,
      sources,
      canonicalStudy,
      coverageGaps,
      documentPages,
    });
    const readProblems = readProblemsFromCoverage(coverageGaps, (id) => evidence?.labels.get(id), pageCountFor);
    return {
      documents,
      labels: evidence?.labels ?? new Map(),
      chipLabels: evidence?.chipLabels ?? new Map(),
      readProblems,
      conflicts: view.blocks.find((block) => block.name === "conflicts")?.rows ?? [],
      timeline: view.blocks.find((block) => block.name === "timeline")?.rows ?? [],
      missing: groupMissing([], readProblems, view.spineSource),
      documentRequestList:
        view.components?.find((component) => component.name === DOCUMENT_REQUEST_LIST_COMPONENT) ?? null,
      documentDate: (id: string) => documents.find((row) => row.id === id)?.date ?? null,
      citationContexts: evidence?.citationContexts ?? new Map(),
      roleFor: (id: string) => evidence?.chipLabels.get(id) ?? evidence?.labels.get(id) ?? "",
    };
  }, [view, sources, canonicalStudy, coverageGaps, documentPages]);

  const allOpenItems = useMemo(
    () => [...topics.flatMap((topic) => topic.openItems), ...otherOpenItems],
    [topics, otherOpenItems],
  );

  const statementCount = useMemo(
    () => topics.reduce((total, topic) => total + topic.statements.length, 0),
    [topics],
  );

  const documentCount = model.documents.length;
  const acceptedLabel = formatAcceptedDay(acceptedAt ?? preparation?.studyRevision?.createdAt ?? null);
  const filtering = findQuery.trim() !== "";

  const kindCounts = useMemo(() => {
    const counts = { missing: 0, difference: 0, needs: 0 } as Record<FindingsOpenItemKind, number>;
    for (const item of allOpenItems) counts[item.kind] += 1;
    return counts;
  }, [allOpenItems]);

  const presentKinds = (["missing", "difference", "needs"] as const).filter((kind) => kindCounts[kind] > 0);

  const filteredOpenItems = useMemo(() => {
    return allOpenItems.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      const refs = itemRefs(item, sources);
      return matchesFilter(findQuery, [
        item.title,
        item.question,
        ...roleTexts(refs, (id) => model.roleFor(id)),
      ]);
    });
  }, [allOpenItems, kindFilter, findQuery, sources, model]);

  const filteredTopics = useMemo(() => {
    if (!filtering) return topics;
    return topics
      .map((topic) => ({
        ...topic,
        statements: topic.statements.filter((statement) =>
          matchesFilter(findQuery, [
            topic.title,
            statement.text,
            ...roleTexts(statementRefs(statement), (id) => model.roleFor(id)),
          ]),
        ),
      }))
      .filter((topic) => topic.statements.length > 0);
  }, [topics, filtering, findQuery, model]);

  const filteredStatementCount = filteredTopics.reduce((total, topic) => total + topic.statements.length, 0);

  const filteredConflicts = useMemo(() => {
    if (!filtering) return model.conflicts;
    return model.conflicts.filter((row) =>
      matchesFilter(findQuery, [
        row.statement,
        ...row.values.map((value) => value.valueAsWritten),
        ...roleTexts(
          row.values.map((value) => ({
            sourceDocumentId: value.sourceRef.sourceDocumentId,
            pageNumber: value.sourceRef.pageNumber,
            quote: value.sourceRef.quote,
          })),
          (id) => model.roleFor(id),
        ),
      ]),
    );
  }, [model.conflicts, filtering, findQuery, model]);

  const filteredTimeline = useMemo(() => {
    if (!filtering) return model.timeline;
    return model.timeline.filter((row) =>
      matchesFilter(findQuery, [
        row.statement,
        row.asWritten,
        ...roleTexts(rowChipsFromRow(row), (id) => model.roleFor(id)),
      ]),
    );
  }, [model.timeline, filtering, findQuery, model]);

  function rowChipsFromRow(row: (typeof model.timeline)[number]): ChipRef[] {
    return row.values.map((value) => ({
      sourceDocumentId: value.sourceRef.sourceDocumentId,
      pageNumber: value.sourceRef.pageNumber,
      quote: value.sourceRef.quote,
      factIds: [value.factId],
    }));
  }

  const totalRows =
    allOpenItems.length + statementCount + model.conflicts.length + model.timeline.length;
  const showFindBar = totalRows > FIND_BAR_THRESHOLD;

  const toc: FindingsTocEntry[] = useMemo(
    () => [
      { id: SECTION_REVIEW, label: "To review", count: filteredOpenItems.length },
      ...filteredTopics.map((topic) => ({ id: topic.id, label: topic.title, count: topic.statements.length })),
      { id: SECTION_MORE, label: "Supporting detail", count: null },
    ],
    [filteredOpenItems.length, filteredTopics],
  );

  const activeSection = useFindingsScrollSpy(toc.map((entry) => entry.id));

  const jumpTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const awaitingAck =
    preparation?.processingRun?.status === "AWAITING_ACKNOWLEDGEMENT" ||
    preparation?.studyRevision?.coverageAcknowledgement === "PENDING";

  const reviewItem = allOpenItems.find((item) => item.id === reviewId);

  const glanceEntries: GlanceEntry[] = glanceMetrics.slice(0, 4).map((metric) => ({
    id: metric.id,
    label: metric.label,
    value: metric.value,
    sub: metric.sub ?? undefined,
    refs:
      metric.values.length > 0
        ? metric.values.map((value) => ({
            sourceDocumentId: value.sourceRef.sourceDocumentId,
            pageNumber: value.sourceRef.pageNumber,
            quote: value.sourceRef.quote,
            factIds: [value.factId],
          }))
        : undefined,
    onHowCalculated:
      metric.calculationId && pack ? () => setCalculationId(metric.calculationId) : undefined,
  }));

  const kindSegmented =
    presentKinds.length > 1 ? (
      <Segmented
        ariaLabel="Filter open items"
        testId="findings-kind-filter"
        value={kindFilter}
        onChange={setKindFilter}
        options={[
          { id: "all", label: "All", count: allOpenItems.length },
          ...presentKinds.map((kind) => ({
            id: kind,
            label: kind === "missing" ? "Missing" : kind === "difference" ? "Changed" : "To review",
            count: kindCounts[kind],
          })),
        ]}
      />
    ) : null;

  const showReviewList = !expanded[SECTION_REVIEW] && !filtering ? filteredOpenItems.slice(0, LIMIT_ITEMS) : filteredOpenItems;
  const hiddenReview = !filtering && !expanded[SECTION_REVIEW] ? Math.max(0, filteredOpenItems.length - LIMIT_ITEMS) : 0;

  const timelineShown = !filtering && !expanded.timeline ? filteredTimeline.slice(0, LIMIT_TIMELINE) : filteredTimeline;
  const hiddenTimeline = !filtering && !expanded.timeline ? Math.max(0, filteredTimeline.length - LIMIT_TIMELINE) : 0;

  const filterStatus =
    filtering && (filteredOpenItems.length > 0 || filteredStatementCount > 0)
      ? `${filteredOpenItems.length} ${filteredOpenItems.length === 1 ? "item" : "items"} and ${filteredStatementCount} ${
          filteredStatementCount === 1 ? "statement" : "statements"
        } match “${findQuery.trim()}”.`
      : filtering
        ? `No items or statements match “${findQuery.trim()}”.`
        : null;

  return (
    <EvidenceViewerProvider
      hiveId={hiveId}
      labels={model.labels}
      chipLabels={model.chipLabels}
      pageCountFor={pageCountFor}
      citationContexts={model.citationContexts}
    >
      <div className="mx-auto flex w-full max-w-col-read flex-col gap-0 overflow-x-clip min-[1280px]:max-w-none min-[1280px]:flex-row min-[1280px]:items-start min-[1280px]:gap-10">
        <div className="min-w-0 max-w-full flex-1 min-[1280px]:max-w-col-read">
          {awaitingAck ? (
            <p className="m-0 mb-3 text-meta text-ink-2" data-testid="findings-pending-decision">
              Review material gaps and accept the Study when you are ready.
            </p>
          ) : null}

          <MetaLine>
            <span>
              Study v{revisionNumber}
              {acceptedLabel ? `, accepted ${acceptedLabel}` : ""}
            </span>
            <MetaDot />
            <span className="tabular-nums">{documentCount} documents</span>
            <MetaDot />
            <span className="tabular-nums">{openItemCount} to review</span>
            <MetaDot />
            <span className="tabular-nums">{statementCount} statements</span>
          </MetaLine>
          <p className="m-0 mt-1 text-meta text-ink-2">
            Findings describe what the documents say. They aren&apos;t independent verification.
          </p>

          {glanceEntries.length > 0 ? (
            <div className="mt-5" data-testid="findings-metrics">
              <GlanceRow entries={glanceEntries} />
            </div>
          ) : null}

          <FindingsFindBar
            visible={showFindBar}
            query={findQuery}
            onQueryChange={setFindQuery}
            onClear={() => setFindQuery("")}
            matchSummary={filterStatus}
            toc={toc}
            jumpTo={jumpTo}
          />

          <Section
            id={SECTION_REVIEW}
            title={`To review ${filteredOpenItems.length}`}
            headingRight={kindSegmented}
            className="mt-6"
          >
            {filteredOpenItems.length === 0 ? (
              <p className="m-0 border-b border-line py-3.5 text-small text-ink-2" data-testid="findings-review-empty">
                {filtering ? "No items match." : "Everything has been reviewed."}
              </p>
            ) : (
              <>
                {showReviewList.map((item) => (
                  <ItemRow
                    key={item.id}
                    state={openItemState(item.kind)}
                    title={item.title}
                    detail={item.question}
                    refs={itemRefs(item, sources)}
                    action={
                      <Button
                        variant="secondary"
                        size="small"
                        type="button"
                        data-review-id={item.id}
                        onClick={(event) => openReview(item.id, event.currentTarget)}
                      >
                        Review
                      </Button>
                    }
                  />
                ))}
                {hiddenReview > 0 ? (
                  <ShowMore
                    label={`Show all ${filteredOpenItems.length}`}
                    onClick={() => setExpanded((value) => ({ ...value, [SECTION_REVIEW]: true }))}
                  />
                ) : null}
                {!filtering && expanded[SECTION_REVIEW] && filteredOpenItems.length > LIMIT_ITEMS ? (
                  <ShowFewer
                    label="Show fewer"
                    onClick={() => setExpanded((value) => ({ ...value, [SECTION_REVIEW]: false }))}
                  />
                ) : null}
              </>
            )}
            <div className="mt-4 border-t border-line pt-3">
              <Link
                href={`${hiveBoardPath(hiveId)}?view=ask`}
                className="text-meta font-medium text-blue-deep no-underline hover:underline"
                data-testid="findings-ask-link"
              >
                Ask {assistantName} about these documents
              </Link>
            </div>
          </Section>

          <Section
            id={SECTION_TOPICS}
            title="What the documents show"
            headingRight={`${filteredTopics.length} topics · ${filteredStatementCount} statements`}
          >
            <div data-testid="findings-topics">
              {filteredTopics.length === 0 ? (
                <p className="m-0 text-small text-ink-2">{filtering ? "No statements match." : "No statements yet."}</p>
              ) : (
                filteredTopics.map((topic) => {
                  const limitKey = `topic-${topic.id}`;
                  const statements =
                    !filtering && !expanded[limitKey] ? topic.statements.slice(0, LIMIT_STATEMENTS) : topic.statements;
                  const hidden = !filtering && !expanded[limitKey] ? Math.max(0, topic.statements.length - LIMIT_STATEMENTS) : 0;
                  return (
                    <StatementTopic
                      key={topic.id}
                      title={topic.title}
                      count={topic.statements.length}
                      uncertain={topic.uncertain}
                    >
                      <div id={topic.id}>
                        {statements.map((statement) => (
                          <Statement key={statement.id} body={statement.text} refs={statementRefs(statement)} />
                        ))}
                        {hidden > 0 ? (
                          <ShowMore
                            label={`${hidden} more in ${topic.title}`}
                            onClick={() => setExpanded((value) => ({ ...value, [limitKey]: true }))}
                          />
                        ) : null}
                        {!filtering && expanded[limitKey] && topic.statements.length > LIMIT_STATEMENTS ? (
                          <ShowFewer
                            label="Show fewer"
                            onClick={() => setExpanded((value) => ({ ...value, [limitKey]: false }))}
                          />
                        ) : null}
                      </div>
                    </StatementTopic>
                  );
                })
              )}
            </div>
          </Section>

          <Section id={SECTION_MORE} title="Supporting detail">
            <Disclosure title="Compare across documents" hint="Where records disagree">
              <FindingsCompareTable rows={filteredConflicts} />
              <FindingsChainEvidenceBlock sections={chainEvidence} />
            </Disclosure>
            <Disclosure
              title="Events in date order"
              hint={`${model.timeline.length} dated events`}
            >
              <FindingsTimelineList rows={timelineShown} />
              {hiddenTimeline > 0 ? (
                <ShowMore
                  label={`Show all ${filteredTimeline.length}`}
                  onClick={() => setExpanded((value) => ({ ...value, timeline: true }))}
                />
              ) : null}
              {!filtering && expanded.timeline && filteredTimeline.length > LIMIT_TIMELINE ? (
                <ShowFewer label="Show fewer" onClick={() => setExpanded((value) => ({ ...value, timeline: false }))} />
              ) : null}
            </Disclosure>
            <Disclosure title="Document coverage" hint="What's complete and what's missing">
              <div className="flex flex-col gap-4">
                <ReadProblemNotice problems={model.readProblems} documentsHref={hiveDocumentsPath(hiveId)} />
                <MissingStudyItems
                  conflicts={model.conflicts}
                  missing={model.missing}
                  documentRequestList={
                    model.documentRequestList && documentRequestListHasContent(model.documentRequestList)
                      ? model.documentRequestList
                      : null
                  }
                  documentDate={model.documentDate}
                />
              </div>
            </Disclosure>
          </Section>
        </div>

        <FindingsOnThisPage toc={toc} activeId={activeSection} onNavigate={jumpTo} />
      </div>

      {calculationId && pack ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          role="presentation"
          onClick={() => setCalculationId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="findings-calculation-title"
            className="max-w-md rounded-card border border-line bg-paper p-[22px] shadow-lg"
            data-testid="findings-calculation-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            {(() => {
              const def = pack.computedValues.find((entry) => entry.id === calculationId);
              if (!def) return null;
              return (
                <>
                  <h3 id="findings-calculation-title" className="m-0 font-brand text-section font-semibold text-ink">
                    {def.label.trim() || def.id}
                  </h3>
                  <p className="m-0 mt-3 text-small text-ink-2">
                    {def.op.trim()} · {def.inputs.trim()}
                    {def.per.trim() ? ` · per ${def.per.trim()}` : ""}
                  </p>
                  <Button variant="secondary" type="button" className="mt-4" onClick={() => setCalculationId(null)}>
                    Close
                  </Button>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

      {reviewItem ? (
        <FindingsReviewDrawer
          item={reviewItem}
          view={view}
          sources={sources}
          canonicalStudy={canonicalStudy}
          documentDate={model.documentDate}
          onClose={closeReview}
        />
      ) : null}
    </EvidenceViewerProvider>
  );
}