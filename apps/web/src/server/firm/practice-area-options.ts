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

export function practiceAreaAllowlistFromPacks(cwd?: string): ReadonlySet<string> {
  const { entries } = loadPackEntries(cwd);
  return new Set(entries.map((entry) => entry.id));
}

export function loadPracticeAreaSetupOptions(cwd?: string): PracticeAreaSetupOption[] {
  const { entries } = loadPackEntries(cwd);
  return entries.map((entry) => ({
    packId: entry.id,
    label: entry.pack.meta.title,
    description: firstDescriptionSentence(entry.pack.meta.description),
  }));
}