import { practiceAreaPackIds } from "@hiveforyou/contracts";

import { loadPackEntries } from "@/server/pipeline/pack-loader";

export type PracticeAreaSetupOption = {
  packId: string;
  label: string;
  description: string;
};

function firstDescriptionSentence(description: string): string {
  const line = description.split(/\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  const sentence = line.split(/\.\s/)[0]?.trim() ?? line;
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

export function loadPracticeAreaSetupOptions(): PracticeAreaSetupOption[] {
  const { entries } = loadPackEntries();
  const byId = new Map(entries.map((entry) => [entry.id, entry.pack]));
  return practiceAreaPackIds().flatMap((packId) => {
    const pack = byId.get(packId);
    if (!pack) return [];
    return [
      {
        packId,
        label: pack.meta.title,
        description: firstDescriptionSentence(pack.meta.description),
      },
    ];
  });
}