import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  renderClientInviteEmail,
  renderFirmInviteEmail,
  renderProfessionalInviteEmail,
} from "@/server/email/invitation-templates";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WEB_SRC = path.join(REPO_ROOT, "apps", "web", "src");
const PACKAGES_GLOB = path.join(REPO_ROOT, "packages");
const THIS_FILE = path.normalize(path.join(__dirname, "wording-to-review.test.ts"));

/** Whole words only, so "need your" stays a different sentence. */
const REVIEW_PHRASE = /\bneeds?\s+you\b/i;

/** Client invite subject/body: "needs <n> items from you". */
const INVITE_ITEMS_FROM_YOU = /\bneeds?\s+\d+\s+items\s+from\s+you\b/i;

function walk(dir: string, into: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, into);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue;
    if (path.normalize(full) === THIS_FILE) continue;
    into.push(full);
  }
}

function packageSrcRoots(): string[] {
  const roots: string[] = [];
  for (const name of readdirSync(PACKAGES_GLOB)) {
    const src = path.join(PACKAGES_GLOB, name, "src");
    try {
      if (statSync(src).isDirectory()) roots.push(src);
    } catch {
      // package has no src/
    }
  }
  return roots;
}

function scanReviewPhrase(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!REVIEW_PHRASE.test(line)) return;
      if (INVITE_ITEMS_FROM_YOU.test(line)) return;
      hits.push(`${path.relative(REPO_ROOT, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe("to-review wording", () => {
  it("does not say needs you in app or package source", () => {
    const files: string[] = [];
    walk(WEB_SRC, files);
    for (const root of packageSrcRoots()) walk(root, files);
    const hits = scanReviewPhrase(files);
    expect(hits).toEqual([]);
  }, 120_000);

  it("no longer uses the boardNeedsYou identifier", () => {
    const files: string[] = [];
    walk(WEB_SRC, files);
    const hits = files.filter((file) => readFileSync(file, "utf8").includes("boardNeedsYou"));
    expect(hits).toEqual([]);
  });

  it("keeps the old review phrase out of rendered invitation emails", () => {
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