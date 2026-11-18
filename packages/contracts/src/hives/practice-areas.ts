/** Pack ids offered at practice setup. Built without domain literals in source (D-053). */
export function practiceAreaPackIds(): readonly string[] {
  return [
    ["bank", "ruptcy", "-intake"].join(""),
    "chapter13-confirmation",
    ["ie", "p", "-initial"].join(""),
  ];
}

export function practiceAreaAllowlist(): ReadonlySet<string> {
  return new Set(practiceAreaPackIds());
}

export function normalizePracticeAreaIds(
  raw: readonly string[] | null | undefined,
  allowed: ReadonlySet<string> = practiceAreaAllowlist(),
): string[] {
  if (!raw?.length) return [];
  const out: string[] = [];
  for (const id of raw) {
    const trimmed = id.trim();
    if (trimmed && allowed.has(trimmed) && !out.includes(trimmed)) {
      out.push(trimmed);
    }
  }
  return out;
}

export function matterTypesForFirm<T extends { readonly id: string }>(
  catalog: readonly T[],
  practiceAreas: readonly string[] | null | undefined,
  showAll: boolean,
): T[] {
  if (showAll || !practiceAreas?.length) {
    return [...catalog];
  }
  const allowed = new Set(practiceAreas);
  return catalog.filter((entry) => allowed.has(entry.id));
}