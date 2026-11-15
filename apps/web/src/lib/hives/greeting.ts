export function greetingLine(firstName: string | null, email: string | null): string {
  const hour = new Date().getHours();
  const time =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const trimmed = firstName?.trim();
  const name =
    trimmed && trimmed.length > 0
      ? trimmed
      : email && email.includes("@")
        ? email.split("@")[0]
        : "there";
  return `${time}, ${name}`;
}