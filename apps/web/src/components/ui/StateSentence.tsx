import { buildStateSentence, type StateSentenceInput } from "./state-sentence";

export function StateSentence(input: StateSentenceInput) {
  const { lead, trailing } = buildStateSentence(input);
  return (
    <p className="m-0 max-w-[640px] font-brand text-[20px] font-medium leading-[1.35] tracking-[-0.02em] text-ink min-[760px]:text-state">
      {lead}
      {trailing ? (
        <>
          {" "}
          <em className="font-medium not-italic text-ink-3">{trailing}</em>
        </>
      ) : null}
    </p>
  );
}
