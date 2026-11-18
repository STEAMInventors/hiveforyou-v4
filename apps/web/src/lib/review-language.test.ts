import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  renderClientInviteEmail,
  renderFirmInviteEmail,
  renderProfessionalInviteEmail,
} from "@/server/email/invitation-templates";

/** Whole words only, so "need your" stays a different sentence. */
const REVIEW_PHRASE = /\bneeds?\s+you\b/i;

const WEB_SRC = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(WEB_SRC, "../../..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.(ts|tsx)$/.test(entry)) continue;
    found.push(full);
  }
  return found;
}

function phraseHits(filePath: string): string[] {
  const relative = path.relative(REPO_ROOT, filePath).replaceAll("\\", "/");
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .flatMap((line, index) => (REVIEW_PHRASE.test(line) ? [`${relative}:${index + 1}`] : []));
}

describe("review language", () => {
  it("keeps the old review phrase out of rendered pages and email templates", () => {
    const roots = [
      path.join(WEB_SRC, "app"),
      path.join(WEB_SRC, "components"),
      path.join(WEB_SRC, "lib"),
      path.join(WEB_SRC, "server", "email"),
      path.join(REPO_ROOT, "packages", "contracts", "src", "hives"),
    ];
    const hits = roots.flatMap((root) => sourceFiles(root).flatMap(phraseHits));
    expect(hits).toEqual([]);

    const emails = [
      renderClientInviteEmail({
        professionalName: "Alex Morgan",
        inviteUrl: "https://example.com/invite/abc",
        requestedItemCount: 2,
      }),
      renderClientInviteEmail({
        professionalName: "Alex Morgan",
        inviteUrl: "https://example.com/invite/abc",
        requestedItemCount: 0,
      }),
      renderProfessionalInviteEmail({
        ownerName: "Jordan Lee",
        hiveName: "Maya Chen",
        inviteUrl: "https://example.com/invite/def",
      }),
      renderFirmInviteEmail({
        ownerName: "Maria",
        firmName: "Rivera Law",
        inviteUrl: "https://example.com/firm-invite/abc",
      }),
    ];
    for (const email of emails) {
      expect(email.text).not.toMatch(REVIEW_PHRASE);
      expect(email.html).not.toMatch(REVIEW_PHRASE);
    }
  });
});
