/** Initials from an email's local part ("maya.rivera@…" → "MR"); null when there is nothing usable. */
export function accountInitials(email: string | null | undefined): string | null {
  const local = email?.split("@")[0] ?? "";
  const parts = local.split(/[._+-]+/).filter((part) => /^[a-z]/i.test(part));
  if (parts.length === 0) return null;
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}
