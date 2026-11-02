"use client";

import { type ApplicationView, type ApplicationViewComponent, type BoundClaim, isKnownViewComponent } from "@hiveforyou/contracts";

import { CARD_CLASS, formatValue, HEADING_CLASS, SourceChips, StatusBadge } from "./a2ui-parts";
import { ChartView } from "./ChartView";
import { ScenarioExplorerView } from "./ScenarioExplorerView";

type Of<N extends ApplicationViewComponent["component"]> = Extract<ApplicationViewComponent, { component: N }>;

const SEVERITY: Record<"HIGH" | "MEDIUM" | "LOW", string> = {
  HIGH: "bg-coral-wash text-coral-deep",
  MEDIUM: "bg-honey-wash text-honey-deep",
  LOW: "bg-mist text-ink-muted",
};

const BLOCK_TONE: Record<string, string> = {
  UNCERTAINTY: "border-l-2 border-honey pl-3",
  LIMITATION: "border-l-2 border-line-strong pl-3",
};

function ClaimItem({ claim }: { claim: BoundClaim }) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-line pb-3 last:border-b-0 last:pb-0">
      <span className="flex flex-wrap items-start gap-2">
        <span className="flex-1 text-[15px] leading-[1.55] text-ink">{claim.text}</span>
        {claim.numericStatus ? <StatusBadge status={claim.numericStatus} /> : null}
      </span>
      {claim.quotes.slice(0, 2).map((quote) => (
        <q key={quote} className="text-[13.5px] italic leading-[1.5] text-ink-muted">
          {quote}
        </q>
      ))}
      <SourceChips refs={claim.refs} />
    </li>
  );
}

const REGISTRY: { [N in ApplicationViewComponent["component"]]: (props: Of<N>) => React.ReactNode } = {
  Narrative: ({ heading, blocks }) => (
    <section className={CARD_CLASS} data-component="Narrative">
      {heading ? <h3 className={HEADING_CLASS}>{heading}</h3> : null}
      {blocks.map((block, index) => (
        <div key={index} className={`flex flex-col gap-1.5 ${BLOCK_TONE[block.type] ?? ""}`}>
          <p className="m-0 text-[15px] leading-[1.6] text-ink">{block.text}</p>
          <SourceChips refs={block.refs} />
        </div>
      ))}
    </section>
  ),
  KeyFindings: ({ title, items }) => (
    <section className={CARD_CLASS} data-component="KeyFindings">
      <h3 className={HEADING_CLASS}>{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((claim) => (
          <ClaimItem key={claim.id} claim={claim} />
        ))}
      </ul>
    </section>
  ),
  EvidencePanel: ({ title, claims }) => (
    <section className={CARD_CLASS} data-component="EvidencePanel">
      <h3 className={HEADING_CLASS}>{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {claims.map((claim) => (
          <ClaimItem key={claim.id} claim={claim} />
        ))}
      </ul>
    </section>
  ),
  Metric: ({ label, value, unit, status, usesAssumptions, refs }) => (
    <section className={CARD_CLASS} data-component="Metric">
      <span className="text-[13.5px] font-medium text-ink-muted">{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-brand text-[28px] font-semibold text-ink">{formatValue(value, unit)}</span>
        <StatusBadge status={status} usesAssumptions={usesAssumptions} />
      </span>
      <SourceChips refs={refs} />
    </section>
  ),
  RecordTable: ({ title, columns, rows }) => (
    <section className={CARD_CLASS} data-component="RecordTable">
      <h3 className={HEADING_CLASS}>{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line text-ink-subtle">
              {columns.map((column) => (
                <th key={column} className="py-1.5 pr-3 font-medium">
                  {column}
                </th>
              ))}
              <th className="py-1.5 font-medium">Sources</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-line align-top last:border-b-0">
                {row.cells.map((cell, cellIndex) => (
                  <td key={cellIndex} className="py-2 pr-3 text-ink">
                    {cell}
                  </td>
                ))}
                <td className="py-2">
                  <SourceChips refs={row.refs} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  ),
  Comparison: ({ title, leftLabel, rightLabel, items }) => (
    <section className={CARD_CLASS} data-component="Comparison">
      <h3 className={HEADING_CLASS}>{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-line text-ink-subtle">
              <th className="py-1.5 pr-3 font-medium">
                <span className="sr-only">Item</span>
              </th>
              <th className="py-1.5 pr-3 font-medium">{leftLabel}</th>
              <th className="py-1.5 font-medium">{rightLabel}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index} className="border-b border-line align-top last:border-b-0">
                <th scope="row" className="py-2 pr-3 font-medium text-ink">
                  {item.label}
                  <div className="mt-1 font-normal">
                    <SourceChips refs={item.refs} />
                  </div>
                </th>
                <td className="py-2 pr-3 text-ink">{item.left}</td>
                <td className="py-2 text-ink">{item.right}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  ),
  Timeline: ({ title, events }) => (
    <section className={CARD_CLASS} data-component="Timeline">
      <h3 className={HEADING_CLASS}>{title}</h3>
      <ol className="m-0 flex list-none flex-col gap-3 border-l border-line p-0 pl-4">
        {events.map((event, index) => (
          <li key={index} className="flex flex-col gap-1">
            <span className="font-mono text-[12.5px] text-ink-subtle">{event.date}</span>
            <span className="text-[15px] leading-[1.55] text-ink">{event.text}</span>
            <SourceChips refs={event.refs} />
          </li>
        ))}
      </ol>
    </section>
  ),
  IssueList: ({ title, issues }) => (
    <section className={CARD_CLASS} data-component="IssueList">
      <h3 className={HEADING_CLASS}>{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {issues.map((issue, index) => (
          <li key={index} className="flex flex-col gap-1.5">
            <span className="flex items-start gap-2">
              <span className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium ${SEVERITY[issue.severity]}`}>
                {issue.severity.toLowerCase()}
              </span>
              <span className="text-[15px] leading-[1.55] text-ink">{issue.text}</span>
            </span>
            <SourceChips refs={issue.refs} />
          </li>
        ))}
      </ul>
    </section>
  ),
  QuestionList: ({ title, questions }) => (
    <section className={CARD_CLASS} data-component="QuestionList">
      <h3 className={HEADING_CLASS}>{title}</h3>
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
        {questions.map((question, index) => (
          <li key={index} className="text-[15px] leading-[1.55] text-ink">
            {question.text}
            <div className="mt-1">
              <SourceChips refs={question.refs} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  ),
  Checklist: ({ title, items }) => (
    <section className={CARD_CLASS} data-component="Checklist">
      <h3 className={HEADING_CLASS}>{title}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-[15px] leading-[1.55] text-ink">
            <span aria-hidden className="mt-[5px] h-3.5 w-3.5 shrink-0 rounded-[3px] border border-line-strong" />
            <span className="flex flex-col gap-1">
              {item.text}
              <SourceChips refs={item.refs} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  ),
  Chart: (props) => <ChartView {...props} />,
  ScenarioExplorer: (props) => <ScenarioExplorerView {...props} />,
  SourceReferences: ({ title, sources }) =>
    sources.length === 0 ? null : (
      <section className={CARD_CLASS} data-component="SourceReferences">
        <h3 className={HEADING_CLASS}>{title}</h3>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {sources.map((source) => (
            <li key={source.sourceDocumentId} className="text-[14px] text-ink">
              <span className="font-medium">{source.fileName}</span>
              <span className="text-ink-muted"> — pages {source.pageNumbers.join(", ")}</span>
            </li>
          ))}
        </ul>
      </section>
    ),
};

/** Renders a stored, validated view. Anything outside the catalog renders a neutral fallback. */
export function A2uiView({ view }: { view: ApplicationView }) {
  return (
    <div className="flex flex-col gap-4" data-testid="a2ui-view" data-layout={view.layout}>
      {view.components.map((component) => {
        if (!isKnownViewComponent(component)) {
          return (
            <p key={(component as { id?: string }).id} className="m-0 rounded-card border border-dashed border-line px-5 py-4 text-[14px] text-ink-muted" data-component="Fallback">
              This part of the report can&apos;t be shown.
            </p>
          );
        }
        const render = REGISTRY[component.component] as (props: ApplicationViewComponent) => React.ReactNode;
        return <div key={component.id}>{render(component)}</div>;
      })}
    </div>
  );
}
