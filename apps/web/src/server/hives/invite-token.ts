import { createHash, randomBytes } from "node:crypto";

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  return { token, tokenHash };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}