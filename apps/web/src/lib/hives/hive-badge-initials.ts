/** First two words in the hive name that start with a letter (sidebar badge). */
export function hiveBadgeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => /^[A-Za-z]/.test(word));
  const letters = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return letters || "?";
}