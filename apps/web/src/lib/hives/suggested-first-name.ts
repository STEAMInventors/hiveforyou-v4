export function suggestedFirstNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const token = local.replace(/[._+-]+/g, " ").trim().split(/\s+/)[0] ?? "";
  if (!token || !/[a-zA-Z]/.test(token)) {
    return "";
  }
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}