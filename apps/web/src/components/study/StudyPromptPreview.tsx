import {
  type AnswerType,
  isActiveProcessingRunStatus,
  type PreviewStaleness,
  type ProcessingRun,
  type SourcePageRef,
  type StudyPromptPreview as StudyPromptPreviewData,
} from "@hiveforyou/contracts";

import { CopyPromptButton } from "./CopyPromptButton";

type StudyPromptPreviewProps = {
  preview: StudyPromptPreviewData;
  staleness: PreviewStaleness | null;
  activeRun: ProcessingRun | null;
};

const ANSWER_TYPE_LABEL: Record<AnswerType, string> = {
  FACT: "Fact",
  LIST: "List",
  COMPARISON: "Comparison",
  CHRONOLOGY: "Chronology",
  CALCULATION: "Calculation",
  SUMMARY: "Summary",
  YES_NO: "Yes or no",
  OTHER: "Other",
};

const STALENESS_TEXT: Record<string, string> = {
  DOCUMENT_ADDED: "a document was added",
  DOCUMENT_REMOVED: "a document was removed",
  DOCUMENT_READ_CHANGED: "a document was read again",
  INTENT_ADDED: "your request changed",
};

const CHIP_CLASS =
  "inline-flex items-center rounded-md border border-honey/40 bg-honey-wash px-2 py-0.5 font-mono text-[12.5px] text-honey-deep";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-card border border-line bg-paper px-6 py-6 sm:px-8">
      <h2 id={id} className="m-0 font-brand text-[21px] font-medium text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PageChips({ refs, fileNames }: { refs: SourcePageRef[]; fileNames: Map<string, string> }) {
  if (refs.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {refs.map((ref) => {
        const name = fileNames.get(ref.sourceDocumentId) ?? "Document";
        return (
          <span key={`${ref.sourceDocumentId}:${ref.pageNumber}`} className={CHIP_CLASS} title={name}>
            <span className="max-w-[180px] truncate">{name}</span>&nbsp;· p.{ref.pageNumber}
          </span>
        );
      })}
    </span>
  );
}

function TextList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] font-semibold uppercase tracking-[0.04em] text-ink-subtle">{label}</span>
      <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-[14.5px] leading-[1.5] text-ink-muted">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function StudyPromptPreview({ preview, staleness, activeRun }: StudyPromptPreviewProps) {
  const { intentDecomposition: intent, domainProposal: domain, investigationPlan: plan, sourceSnapshot } = preview;
  const specialistQuestions = preview.intentIntelligence?.questions ?? [];
  const reviews = preview.intentIntelligence?.completenessReview ?? [];
  const fileNames = new Map<string, string>();
  for (const doc of sourceSnapshot.documents) fileNames.set(doc.sourceDocumentId, doc.fileName);
  for (const doc of sourceSnapshot.excluded) fileNames.set(doc.sourceDocumentId, doc.fileName);
  const running = activeRun && isActiveProcessingRunStatus(activeRun.status) && activeRun.id !== preview.processingRunId;
  const totalPages = sourceSnapshot.documents.reduce((sum, doc) => sum + doc.verifiedPageCount, 0);
  const staleReasons = [...new Set((staleness?.reasons ?? []).map((reason) => STALENESS_TEXT[reason.kind] ?? "sources changed"))];

  return (
    <div className="flex flex-col gap-5" data-testid="study-prompt-preview">
      <header className="flex flex-col gap-2">
        <span className="w-fit rounded-full bg-mist px-3 py-1 text-[12.5px] font-medium text-ink-muted">
          Prepared — Canonical Study not yet executed
        </span>
        <h1 className="m-0 font-brand text-[30px] font-semibold text-ink">Study prompt</h1>
        <p className="m-0 text-[13px] text-ink-subtle">
          Prepared {new Date(preview.createdAt).toUTCString()} · {preview.promptId}
        </p>
      </header>

      {running ? (
        <p role="status" className="m-0 rounded-control bg-honey-wash px-4 py-3 text-sm text-honey-deep">
          A new analysis is running. This page shows the previous prompt until it finishes.
        </p>
      ) : null}
      {staleness?.stale ? (
        <p role="status" className="m-0 rounded-control bg-honey-wash px-4 py-3 text-sm text-honey-deep">
          This prompt is out of date because {staleReasons.join(", ")}. Analyze again from Documents to refresh it.
        </p>
      ) : null}

      <Section id="study-intent" title="Your request">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {intent.intents.map((item) => (
            <li key={item.intentRequestId}>
              <blockquote className="m-0 whitespace-pre-wrap border-l-[3px] border-honey pl-4 text-[15px] leading-[1.55] text-ink">
                {item.verbatimText}
              </blockquote>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="study-domain" title="Domain">
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[17px] font-semibold text-ink">
            {domain.primary.label}
            {domain.primary.subdomain ? <span className="font-normal text-ink-muted"> — {domain.primary.subdomain}</span> : null}
          </p>
          <p className="m-0 text-[13px] text-ink-subtle">
            Model confidence: {domain.primary.confidence.toLowerCase()} (advisory, not proof)
            {domain.unknownDomain ? " · domain unclear" : ""}
            {domain.mixedDomain ? " · several domains" : ""}
            {domain.ambiguous ? " · ambiguous" : ""}
          </p>
        </div>
        <p className="m-0 text-[14.5px] leading-[1.55] text-ink-muted">{domain.primary.reasoning}</p>
        <PageChips refs={domain.primary.supportingRefs} fileNames={fileNames} />
        {domain.alternatives.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] font-semibold uppercase tracking-[0.04em] text-ink-subtle">Also possible</span>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {domain.alternatives.map((alternative, index) => (
                <li key={index} className="flex flex-col gap-1">
                  <span className="text-[14.5px] font-medium text-ink">
                    {alternative.label}
                    {alternative.subdomain ? ` — ${alternative.subdomain}` : ""}
                  </span>
                  <span className="text-[14px] text-ink-muted">{alternative.reasoning}</span>
                  <PageChips refs={alternative.supportingRefs} fileNames={fileNames} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <TextList label="Notes" items={domain.ambiguityNotes} />
      </Section>

      <Section id="study-objectives" title="Objectives">
        <ol className="m-0 flex list-none flex-col gap-5 p-0">
          {intent.objectives.map((objective) => {
            const planQuestions = plan.questions.filter((question) => question.objectiveId === objective.id);
            const specialist = specialistQuestions.filter((question) => question.objectiveId === objective.id);
            const remainingLimits = reviews.find((review) => review.objectiveId === objective.id)?.remainingLimits ?? [];
            return (
              <li key={objective.id} className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[12px] text-ink-subtle">{objective.id}</span>
                  <span className="text-[16px] font-semibold text-ink">{objective.title}</span>
                  <span className="text-[14.5px] leading-[1.55] text-ink-muted">{objective.description}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-semibold uppercase tracking-[0.04em] text-ink-subtle">
                    What you asked, broken down
                  </span>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {objective.questions.map((question) => (
                      <li key={question.id} className="text-[14.5px] leading-[1.5] text-ink">
                        <span className="font-mono text-[12px] text-ink-subtle">{question.id}</span> {question.text}
                      </li>
                    ))}
                  </ul>
                </div>
                {specialist.length > 0 ? (
                  <div className="flex flex-col gap-2" data-testid={`specialist-questions-${objective.id}`}>
                    <span className="text-[12.5px] font-semibold uppercase tracking-[0.04em] text-ink-subtle">
                      What a specialist would ask
                    </span>
                    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                      {specialist.map((question) => (
                        <li key={question.id} className="flex flex-col gap-1">
                          <span className="text-[14.5px] font-medium leading-[1.5] text-ink">
                            <span className="font-mono text-[12px] text-ink-subtle">{question.id}</span> {question.question}
                          </span>
                          <span className="text-[14px] leading-[1.5] text-ink-muted">{question.whyItMatters}</span>
                          <span className="text-[12.5px] text-ink-subtle">
                            Supports: {question.supportsOutcome}
                            {question.dependsOn.length > 0 ? ` · after ${question.dependsOn.join(", ")}` : ""}
                          </span>
                          {question.requiresJudgment ? (
                            <span className="w-fit rounded-md border border-line px-2 py-0.5 text-[12.5px] text-ink-muted">
                              Needs an assessment{question.judgmentBasis ? `: ${question.judgmentBasis}` : ""}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <TextList label="The documents alone may not settle" items={remainingLimits} />
                  </div>
                ) : null}
                {planQuestions.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-[12.5px] font-semibold uppercase tracking-[0.04em] text-ink-subtle">
                      Investigation questions
                    </span>
                    <ul className="m-0 flex list-none flex-col gap-3 p-0">
                      {planQuestions.map((question) => (
                        <li key={question.id} className="flex flex-col gap-1.5 rounded-[12px] bg-mist px-4 py-3">
                          <span className="text-[14.5px] font-medium leading-[1.5] text-ink">
                            <span className="font-mono text-[12px] text-ink-subtle">{question.id}</span> {question.establish}
                          </span>
                          <span className="text-[12.5px] text-ink-subtle">
                            {ANSWER_TYPE_LABEL[question.answerType]}
                            {question.specialistQuestionIds?.length ? ` · answers ${question.specialistQuestionIds.join(", ")}` : ""}
                            {question.dependsOn.length > 0 ? ` · after ${question.dependsOn.join(", ")}` : ""}
                          </span>
                          <TextList label="Evidence needed" items={question.requiredEvidence} />
                          <TextList label="Depends on records" items={question.sourceDependencies ?? []} />
                          {question.comparison ? <p className="m-0 text-[14px] text-ink-muted">Compare: {question.comparison}</p> : null}
                          {question.chronology ? <p className="m-0 text-[14px] text-ink-muted">Timeline: {question.chronology}</p> : null}
                          {question.calculation ? <p className="m-0 text-[14px] text-ink-muted">Calculate: {question.calculation}</p> : null}
                          {question.evaluation ? <p className="m-0 text-[14px] text-ink-muted">Assess: {question.evaluation}</p> : null}
                          <TextList label="If evidence is missing" items={question.missingEvidenceConditions} />
                          <p className="m-0 text-[14px] text-ink-muted">Answer shape: {question.deliverable}</p>
                          <PageChips refs={question.domainConsiderationRefs} fileNames={fileNames} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <TextList label="Expected outputs" items={intent.expectedOutputs} />
        <TextList
          label="Open points"
          items={intent.ambiguities.map((ambiguity) => `${ambiguity.description} — ${ambiguity.clarificationQuestion}`)}
        />
        <TextList label="Context not provided" items={intent.missingContext} />
      </Section>

      <Section id="study-coverage" title="Document coverage">
        <p className="m-0 text-[14.5px] text-ink-muted">
          {sourceSnapshot.documents.length} document{sourceSnapshot.documents.length === 1 ? "" : "s"}, {totalPages} page
          {totalPages === 1 ? "" : "s"} included
          {preview.coverageComplete ? "." : " — some content is missing and was acknowledged before analysis."}
        </p>
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[14px] border border-line p-0">
          {sourceSnapshot.documents.map((doc) => {
            const sampled = preview.sampleCoverage.pages
              .filter((page) => page.sourceDocumentId === doc.sourceDocumentId)
              .map((page) => page.pageNumber);
            return (
              <li key={doc.sourceDocumentId} className="flex flex-col gap-0.5 border-b border-line px-4 py-3 last:border-b-0">
                <span className="truncate text-[14.5px] font-medium text-ink" title={doc.fileName}>
                  {doc.fileName}
                </span>
                <span className="text-[13px] text-ink-subtle">
                  {doc.verifiedPageCount} of {doc.totalPhysicalPages} pages read
                  {doc.missingPageNumbers.length > 0 ? ` · missing ${doc.missingPageNumbers.join(", ")}` : ""}
                  {doc.emptyPageNumbers.length > 0 ? ` · no text on ${doc.emptyPageNumbers.join(", ")}` : ""}
                  {sampled.length > 0 ? ` · domain sampled from p.${sampled.join(", ")}` : " · not sampled for domain"}
                </span>
              </li>
            );
          })}
          {sourceSnapshot.excluded.map((doc) => (
            <li key={doc.sourceDocumentId} className="flex flex-col gap-0.5 border-b border-line px-4 py-3 last:border-b-0">
              <span className="truncate text-[14.5px] font-medium text-ink-muted" title={doc.fileName}>
                {doc.fileName}
              </span>
              <span className="text-[13px] text-coral-deep">Not included</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="study-prompt" title="Full prompt">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="break-all font-mono text-[11px] text-ink-subtle">{preview.promptDigest}</span>
          <CopyPromptButton text={preview.promptText} />
        </div>
        <pre
          className="m-0 max-h-[640px] overflow-auto whitespace-pre-wrap break-words rounded-[12px] bg-mist px-4 py-4 font-mono text-[12.5px] leading-[1.55] text-ink"
          tabIndex={0}
          aria-label="Full study prompt"
          data-testid="study-prompt-text"
        >
          {preview.promptText}
        </pre>
      </Section>
    </div>
  );
}
