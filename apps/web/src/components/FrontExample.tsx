"use client";

import { useState } from "react";

import type { FrontExampleContent } from "@/content/front-page";
import { ProgressMeter } from "@/components/ui/ProgressMeter";
import { StatusDot } from "@/components/ui/StatusDot";
import { buildStateSentence } from "@/components/ui/state-sentence";
import { SOURCE_REF_CLASS, SourceRefIcon } from "@/components/ui/source-ref-look";

/** The front page's example hive. Statements are buttons; the cited page swaps on selection. */
export function FrontExample({
  example,
  initialSelectedIndex = 0,
}: {
  example: FrontExampleContent;
  initialSelectedIndex?: number;
}) {
  const [selected, setSelected] = useState(initialSelectedIndex);
  const statement = example.statements[selected] ?? example.statements[0];
  const document = statement ? example.documents[statement.document] : undefined;
  const { lead } = buildStateSentence({
    documentsIn: example.documentsIn,
    checklistSize: example.documentsAsked,
    toReview: example.statements.length,
    stillToCome: example.missing.length,
  });

  return (
    <div
      className="mt-7 overflow-hidden rounded-popover border border-line bg-paper text-left"
      data-testid="front-example"
    >
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1.5 border-b border-line px-4 py-3.5 text-[13px] text-ink-3 min-[760px]:px-6">
        <span>
          <b className="font-semibold text-ink">{example.client}</b> · {example.purpose}
        </span>
        <span>{example.badge}</span>
      </div>
      <div className="grid min-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 px-4 py-7 min-[760px]:px-6">
          <p className="m-0 font-brand text-[20px] font-medium leading-[1.35] tracking-[-0.02em] text-ink min-[760px]:text-[22px]">
            {lead}
          </p>
          <ProgressMeter received={example.documentsIn} total={example.documentsAsked} labelled />
          <div className="mt-[22px]">
            <h3 className="m-0 mb-1 font-sans text-topic font-semibold text-ink-3">{example.statementsTitle}</h3>
            <div className="flex flex-col">
              {example.statements.map((item, index) => {
                const cited = example.documents[item.document];
                const pressed = index === selected;
                return (
                  <button
                    key={item.text}
                    type="button"
                    aria-pressed={pressed}
                    className={`-mx-3 block w-[calc(100%+24px)] rounded-[10px] border-0 px-3 py-2.5 text-left text-body text-ink transition-colors ${
                      pressed ? "bg-blue-wash" : "bg-transparent hover:bg-mist"
                    }`}
                    onClick={() => setSelected(index)}
                  >
                    <span className="block text-meta font-semibold text-ink-3">{item.topic}</span>
                    {item.text}
                    {cited ? (
                      <span className="mt-2 flex max-w-full flex-wrap gap-1.5">
                        <span className={SOURCE_REF_CLASS} data-testid="source-ref">
                          <SourceRefIcon />
                          <span className="min-w-0 truncate">
                            {cited.role} · <span className="text-ink-3">p.{item.page}</span>
                          </span>
                        </span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-[22px]">
            <h3 className="m-0 mb-1 font-sans text-topic font-semibold text-ink-3">{example.missingTitle}</h3>
            <div className="flex flex-col">
              {example.missing.map((item) => (
                <div
                  key={item}
                  className="flex items-center justify-between gap-3 border-t border-line py-2.5 text-body text-ink"
                >
                  <span>{item}</span>
                  <StatusDot state="missing" />
                </div>
              ))}
            </div>
          </div>
        </div>
        <div
          className="min-w-0 border-t border-line bg-mist px-4 pb-7 pt-5 min-[760px]:border-l min-[760px]:border-t-0 min-[760px]:px-6"
          aria-live="polite"
          data-testid="front-example-page-area"
        >
          {document ? (
            <>
              <div className="mx-auto flex max-w-[460px] items-baseline justify-between gap-3 text-[13px] text-ink-3">
                <span>
                  <b className="font-semibold text-ink">{document.role}</b> · {document.issuer}
                </span>
                <span className="tabular-nums">
                  Page {statement?.page ?? 1} of {document.pages}
                </span>
              </div>
              <div
                key={selected}
                className="mx-auto mt-3.5 max-w-[460px] rounded-page bg-page-warm px-9 pb-12 pt-9 font-quote text-[13.5px] leading-[1.6] text-ink shadow-paper motion-safe:animate-[hfy-pagein_350ms_cubic-bezier(.16,1,.3,1)]"
                data-testid="front-example-page"
              >
                <div className="text-[15px] font-semibold">{document.issuer}</div>
                <div className="text-ink-2">{document.kind}</div>
                <div className="mt-3.5">
                  {document.meta.map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </div>
                <div className="mt-[18px] border-t border-line-strong pt-2.5">
                  {document.lines.map(([label, value], index) => (
                    <div
                      key={label}
                      className={`flex justify-between gap-4 py-[3px] ${
                        index === document.highlight
                          ? "-mx-1.5 rounded-[3px] bg-cite px-1.5 font-semibold shadow-[0_0_0_1px_var(--cite-ring)]"
                          : ""
                      }`}
                    >
                      <span>{label}</span>
                      <span className="tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="m-0 mx-auto mt-3.5 max-w-[460px]">
                <StatusDot state="checked" label={example.checkedLabel} />
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
