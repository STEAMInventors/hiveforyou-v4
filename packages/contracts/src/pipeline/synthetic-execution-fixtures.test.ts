import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeSha256Digest } from "../source-documents/document-read-contracts";
import {
  SYNTHETIC_EXECUTION_FIXTURES,
  SYNTHETIC_MAYA_FIXTURE_ID,
  SYNTHETIC_MAYA_PAGE_DIGESTS,
  identifySyntheticExecutionFixture,
  resolveSyntheticExecutionFixtureId,
} from "./synthetic-execution-fixtures";
import type { FrozenCasePage } from "./extraction-evidence-trust";

const READER_PAGES = path.resolve(import.meta.dirname, "../../../../eval/corpora/special-ed-l001/reader-pages");

function page(text: string, documentId = "33333333-3333-4333-8333-333333333333"): FrozenCasePage {
  return { documentId, pageNumber: 1, text, sourcePageDigest: computeSha256Digest(text) };
}

describe("synthetic execution fixtures", () => {
  it("keeps the one-page fixtures and does not treat a caller flag or development mode as disclosure", () => {
    const source = readFileSync(new URL("./synthetic-execution-fixtures.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/NODE_ENV/);
    const fixture = SYNTHETIC_EXECUTION_FIXTURES[0]!;
    expect(identifySyntheticExecutionFixture({
      fixtureId: fixture.fixtureId,
      hiveId: fixture.hiveId,
      pages: [page(fixture.pageText, fixture.documentId)],
      recordedAuthorization: false,
    }).ok).toBe(true);
    expect(identifySyntheticExecutionFixture({
      fixtureId: "fixture:not-registered",
      hiveId: fixture.hiveId,
      pages: [page(fixture.pageText, fixture.documentId)],
      recordedAuthorization: true,
    })).toMatchObject({ ok: false, reason: "recorded_authorization_not_disclosure" });
    expect(resolveSyntheticExecutionFixtureId({
      hiveId: fixture.hiveId,
      pages: [page("A development page that is not in the registry.")],
    })).toBeNull();
  });

  it("recognizes the synthetic Maya corpus by the reader page texts and nothing smaller or larger", () => {
    const pages: FrozenCasePage[] = readdirSync(READER_PAGES)
      .filter((name) => name.endsWith(".txt"))
      .sort()
      .map((name) => {
        const pageNumber = Number(/\.p(\d+)\.txt$/.exec(name)?.[1]);
        const text = readFileSync(path.join(READER_PAGES, name), "utf8");
        return {
          documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          pageNumber,
          text,
          sourcePageDigest: computeSha256Digest(text),
        };
      });
    expect(pages).toHaveLength(SYNTHETIC_MAYA_PAGE_DIGESTS.length);
    expect(resolveSyntheticExecutionFixtureId({ hiveId: "99999999-9999-4999-8999-999999999999", pages })).toBe(SYNTHETIC_MAYA_FIXTURE_ID);
    const shortened = pages.slice(0, -1);
    expect(resolveSyntheticExecutionFixtureId({ hiveId: pages[0]!.documentId, pages: shortened })).toBeNull();
    const changed = pages.map((item, index) => index === 0 ? page(item.text + " extra", item.documentId) : item);
    expect(resolveSyntheticExecutionFixtureId({ hiveId: "99999999-9999-4999-8999-999999999999", pages: changed })).toBeNull();
  });
});
