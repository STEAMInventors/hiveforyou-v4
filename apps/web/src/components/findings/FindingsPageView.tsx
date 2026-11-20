"use client";

import type {
  CanonicalStudy,
  CoverageGap,
  FindingsChainEvidenceSection,
  FindingsGlanceMetric,
  FindingsOpenItem,
  FindingsTopic,
  GetStudyPreparationResponse,
  Pack,
  StudyView,
  StudyViewSources,
} from "@hiveforyou/contracts";
import { useMemo, useState } from "react";

import { WORKSPACE_SECONDARY } from "@/components/button-classes";
import { HiveAskInput } from "@/components/hive-ask-input";
import { ComparisonCard } from "@/components/study/ComparisonCard";
import { EvidenceViewerProvider, useEvidenceViewer } from "@/components/study/EvidenceViewer";
import { groupMissing } from "@/components/study/MissingList";
import { MissingStudyItems } from "@/components/study/MissingStudyItems";
import { buildHiveEvidenceViewerModel } from "@/components/study/hive-evidence-model";
import { shortDocumentLabels, SourceChips } from "@/components/study/SourceChip";
import { Timeline } from "@/components/study/Timeline";
import { ReadProblemNotice, readProblemsFromCoverage } from "@/components/study/ReadProblemNotice";
import { hiveDocumentsPath, FINDINGS_ANCHORS } from "@/lib/hive-routes";
import type { ChipRef } from "@/components/study/SourceChip";
import { DOCUMENT_REQUEST_LIST_COMPONENT, documentRequestListHasContent } from "@hiveforyou/contracts";

type FindingsPageViewProps = {
  hiveId: string;
  revisionNumber: number;
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

const CARD = "rounded-[14px] border border-line bg-paper p-[22px]";
const DETAILS =
  "group rounded-[14px] border border-line bg-paper [&_summary]:flex [&_summary]:cursor-pointer [&_summary]:list-none [&_summary]:items-center [&_summary]:justify-between [&_summary]:gap-3 [&_summary]:rounded-[14px] [&_summary]:px-[22px] [&_summary]:py-4 [&_summary]:font-medium [&_summary]:text-ink [&_summary]:outline-none [&_summary]:focus-visible:ring-2 [&_summary]:focus-visible:ring-cell-blue-deep";

function openItemBadge(kind: FindingsOpenItem["kind"]): { label: string; className: string } {
  switch (kind) {
    case "missing":
      return { label: "Missing", className: "bg-coral-wash text-coral-deep" };
    case "difference":
      return { label: "Difference", className: "bg-honey-wash text-honey-deep" };
    default:
      return { label: "Needs clarification", className: "bg-cell-blue-wash text-cell-blue-deep" };
  }
}

function openItemChip(item: FindingsOpenItem, sources: StudyViewSources | null): ChipRef | null {
  const factId = item.factIds[0];
  if (!factId || !sources) return null;
  const ref = sources.facts[factId];
  if (!ref) return null;
  return {
    sourceDocumentId: ref.sourceDocumentId,
    pageNumber: ref.pageNumber,
    quote: ref.quote,
    factIds: [factId],
  };
}

function OpenItemEvidenceButton({
  item,
  sources,
  label = "Review",
}: {
  item: FindingsOpenItem;
  sources: StudyViewSources | null;
  label?: string;
}) {
  const viewer = useEvidenceViewer();
  const chip = openItemChip(item, sources);
  return (
    <button
      type="button"
      className={WORKSPACE_SECONDARY}
      disabled={!chip}
      onClick={(event) => {
        if (!chip) return;
        viewer.open(chip, event.currentTarget, { itemId: item.id });
      }}
    >
      {label}
    </button>
  );
}

function FindingsOpenItemCard({ item, sources }: { item: FindingsOpenItem; sources: StudyViewSources | null }) {
  const badge = openItemBadge(item.kind);
  const chips =
    item.factIds.length > 0
      ? item.factIds.flatMap((factId) => {
          const ref = sources?.facts[factId];
          return ref
            ? [{ sourceDocumentId: ref.sourceDocumentId, pageNumber: ref.pageNumber, quote: ref.quote, factIds: [factId] }]
            : [];
        })
      : [];
  return (
    <div className="border-l-[3px] border-honey-deep bg-gradient-to-r from-honey-wash/40 to-transparent py-3 pl-3 pr-1">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className={`rounded-pill px-2 py-0.5 text-[12px] font-semibold ${badge.className}`}>{badge.label}</span>
        <span className="text-[14px] font-semibold text-ink">{item.title}</span>
      </div>
      <p className="m-0 text-[14px] leading-relaxed text-graphite">{item.question}</p>
      {chips.length > 0 ? (
        <div className="mt-2">
          <SourceChips refs={chips} />
        </div>
      ) : null}
      <span className="mt-3 inline-flex">
        <OpenItemEvidenceButton item={item} sources={sources} label="Review context" />
      </span>
    </div>
  );
}

export function FindingsPageView({
  hiveId,
  revisionNumber,
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
  const [calculationId, setCalculationId] = useState<string | null>(null);
  const pageCountFor = (id: string) => documentPages?.[id] ?? documentPages?.[id.toLowerCase()];

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
    const labelled = [...typeByDoc.entries()].map(([sourceDocumentId, typeInPlainWords]) => ({
      sourceDocumentId,
      typeInPlainWords,
      date: documents.find((row) => row.id.toLowerCase() === sourceDocumentId)?.date ?? null,
    }));
    const shortLabels = shortDocumentLabels(labelled);
    const evidence = buildHiveEvidenceViewerModel({
      view,
      sources,
      canonicalStudy,
      coverageGaps,
      documentPages,
    });
    const readProblems = readProblemsFromCoverage(coverageGaps, (id) => shortLabels.get(id), pageCountFor);
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
    };
  }, [view, sources, canonicalStudy, coverageGaps, documentPages]);

  const awaitingAck =
    preparation?.processingRun?.status === "AWAITING_ACKNOWLEDGEMENT" ||
    preparation?.studyRevision?.coverageAcknowledgement === "PENDING";

  const allOpenItems = useMemo(
    () => [...topics.flatMap((topic) => topic.openItems), ...otherOpenItems],
    [topics, otherOpenItems],
  );

  return (
    <EvidenceViewerProvider
      hiveId={hiveId}
      labels={model.labels}
      chipLabels={model.chipLabels}
      pageCountFor={pageCountFor}
      citationContexts={model.citationContexts}
      view={view}
      sources={sources}
      canonicalStudy={canonicalStudy}
      openItems={allOpenItems}
      topics={topics}
      coverageGaps={coverageGaps}
    >
      <div className="flex flex-col gap-5">
        {awaitingAck ? (
          <p className="m-0 text-small text-graphite" data-testid="findings-pending-decision">
            Review material gaps and accept the Study when you are ready.
          </p>
        ) : null}

        <div
          className={`${CARD} border border-cell-blue-tint bg-cell-blue-wash text-[14px] text-ink`}
          data-testid="findings-notice"
        >
          Accepted Study v{revisionNumber} · Findings describe what the documents say; they are not independent verification of
          real-world events.
        </div>

        <section className="flex flex-col gap-4 min-[900px]:flex-row min-[900px]:items-start min-[900px]:justify-between">
          <div>
            <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-cell-blue-deep">The picture so far</p>
            <h2 className="m-0 mt-1 font-brand text-[25px] font-semibold text-ink">What we learned from these documents</h2>
            <p className="m-0 mt-1 text-small text-graphite">
              Organized by topic, with original page references next to every supported statement.
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center rounded-pill px-3 py-1.5 text-small font-semibold ${
              openItemCount > 0 ? "bg-coral-wash text-coral-deep" : "bg-leaf-wash text-leaf-deep"
            }`}
            data-testid="findings-open-count"
            aria-label={openItemCount > 0 ? `${openItemCount} to review` : "Nothing to review"}
          >
            {openItemCount > 0 ? `${openItemCount} to review` : "Nothing to review"}
          </span>
        </section>

        {glanceMetrics.length > 0 ? (
          <div
            className="grid gap-[13px]"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))" }}
            data-testid="findings-metrics"
          >
            {glanceMetrics.map((metric) => (
              <div key={metric.id} className={`${CARD} flex min-w-0 flex-col gap-1`}>
                <span className="text-[12px] text-quiet">{metric.label}</span>
                <span className="font-brand text-[23px] font-semibold text-ink">{metric.value}</span>
                {metric.sub ? <span className="text-[12.5px] text-quiet">{metric.sub}</span> : null}
                {metric.values.length > 0 ? (
                  <div className="max-w-full">
                    <SourceChips
                      refs={metric.values.map((value) => ({
                        sourceDocumentId: value.sourceRef.sourceDocumentId,
                        pageNumber: value.sourceRef.pageNumber,
                        quote: value.sourceRef.quote,
                        factIds: [value.factId],
                      }))}
                    />
                  </div>
                ) : null}
                {metric.calculationId && pack ? (
                  <button
                    type="button"
                    className={`${WORKSPACE_SECONDARY} mt-1 self-start px-3 text-[13px]`}
                    onClick={() => setCalculationId(metric.calculationId)}
                  >
                    See calculation
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div
          id={FINDINGS_ANCHORS.topics}
          className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-2"
          data-testid="findings-topics"
        >
          {topics.map((topic) => (
            <section key={topic.id} className={`${CARD} flex min-w-0 flex-col gap-4`}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 font-brand text-[20px] font-semibold text-ink">{topic.title}</h3>
                {topic.uncertain ? (
                  <span className="rounded-pill bg-honey-wash px-2 py-0.5 text-[12px] font-semibold text-honey-deep">
                    Uncertain
                  </span>
                ) : null}
              </div>
              <hr className="m-0 border-line" />
              {topic.statements.map((statement) => (
                <div key={statement.id} className="border-b border-line pb-3 last:border-b-0">
                  <p className="m-0 text-[14px] leading-[1.6] text-ink">{statement.text}</p>
                  <div className="mt-2 max-w-full min-w-0">
                    <SourceChips
                      refs={statement.values.map((value) => ({
                        sourceDocumentId: value.sourceRef.sourceDocumentId,
                        pageNumber: value.sourceRef.pageNumber,
                        quote: value.sourceRef.quote,
                        factIds: [value.factId],
                      }))}
                    />
                  </div>
                </div>
              ))}
              {topic.openItems.length > 0 ? (
                <div id={FINDINGS_ANCHORS.openItems} className="flex flex-col gap-3">
                  <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-honey-deep">To clarify</p>
                  {topic.openItems.map((item) => (
                    <FindingsOpenItemCard key={item.id} item={item} sources={sources} />
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>

        {otherOpenItems.length > 0 ? (
          <section className={`${CARD} flex flex-col gap-3`} id={FINDINGS_ANCHORS.openItems}>
            <h3 className="m-0 font-brand text-[20px] font-semibold text-ink">Other items to clarify</h3>
            <p className="m-0 text-small text-graphite">Open questions that are not tied to a single topic yet.</p>
            {otherOpenItems.map((item) => (
              <FindingsOpenItemCard key={item.id} item={item} sources={sources} />
            ))}
          </section>
        ) : null}

        <section className={`${CARD} min-w-0`} data-testid="findings-question-card">
          <HiveAskInput hiveId={hiveId} variant="findings" />
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="m-0 font-brand text-[20px] font-semibold text-ink">Explore supporting detail</h3>
          <p className="m-0 text-small text-graphite">Open a section when you need to examine the underlying analysis.</p>
          <details className={DETAILS} data-testid="findings-detail-compare">
            <summary>
              Compare information across documents
              <span className="text-small font-normal text-quiet">Where records disagree</span>
            </summary>
            <div className="flex flex-col gap-5 border-t border-line px-[22px] py-4">
              {model.conflicts.length === 0 ? (
                <p className="m-0 text-small text-graphite">No disagreements recorded in this Study.</p>
              ) : (
                model.conflicts.map((row) => (
                  <ComparisonCard key={row.id} row={row} documentDate={model.documentDate} />
                ))
              )}
              {chainEvidence.length > 0 ? (
                <div className="flex flex-col gap-3" data-testid="findings-chain-evidence">
                  <h4 className="m-0 text-[14px] font-semibold text-ink">How the evidence connects</h4>
                  {chainEvidence.map((section) => (
                    <div key={`${section.chainLabel}:${section.rowLabel}`} className="flex flex-col gap-2">
                      <p className="m-0 text-[14px] font-semibold text-ink">
                        {section.chainLabel}: {section.rowLabel}
                      </p>
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {section.links.map((link) => (
                          <li key={link.linkLabel} className="min-w-0 text-[14px] text-ink">
                            <span className="font-medium">{link.linkLabel}</span>
                            {link.valueText ? <span className="text-graphite"> — {link.valueText}</span> : null}
                            <span className="ml-1 text-[12.5px] text-quiet">({link.statusLabel})</span>
                            {link.values.length > 0 ? (
                              <span className="mt-1 block max-w-full">
                                <SourceChips
                                  refs={link.values.map((value) => ({
                                    sourceDocumentId: value.sourceRef.sourceDocumentId,
                                    pageNumber: value.sourceRef.pageNumber,
                                    quote: value.sourceRef.quote,
                                    factIds: [value.factId],
                                  }))}
                                />
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </details>
          <details className={DETAILS} id={FINDINGS_ANCHORS.timeline} data-testid="findings-detail-timeline">
            <summary>
              See events in date order
              <span className="text-small font-normal text-quiet">Document-backed timeline</span>
            </summary>
            <div className="border-t border-line px-[22px] py-4">
              <Timeline rows={model.timeline} upcomingId={null} />
            </div>
          </details>
          <details className={DETAILS} data-testid="findings-detail-coverage">
            <summary>
              Check document coverage
              <span className="text-small font-normal text-quiet">Missing list and requests</span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-line px-[22px] py-4">
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
          </details>
        </section>

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
              className={`${CARD} max-w-md shadow-lg`}
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
                    <p className="m-0 mt-3 text-small text-graphite">
                      {def.op.trim()} · {def.inputs.trim()}
                      {def.per.trim() ? ` · per ${def.per.trim()}` : ""}
                    </p>
                    <button
                      type="button"
                      className={`${WORKSPACE_SECONDARY} mt-4`}
                      onClick={() => setCalculationId(null)}
                    >
                      Close
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}

      </div>
    </EvidenceViewerProvider>
  );
}