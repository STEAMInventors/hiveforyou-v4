export function greetingLine(firstName: string | null): string {
  const hour = new Date().getHours();
  const time =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const trimmed = firstName?.trim();
  if (trimmed && trimmed.length > 0) {
    return `${time}, ${trimmed}`;
  }
  return time;
}