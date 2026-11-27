/**
 * Closed registry of synthetic pages this process may send to a model.
 * A caller-supplied AUTHORIZED flag, or RECORDED_AUTHORIZATION, is not an entry.
 * The page text is the identification. A different page does not match.
 */
import { computeSha256Digest, normalizeContentDigest } from "../source-documents/document-read-contracts";
import { filingRecordPage } from "./eval/synthetic-domain-fixtures";
import type { FrozenCasePage } from "./extraction-evidence-trust";

export type SyntheticExecutionFixture = {
  fixtureId: string;
  hiveId: string;
  documentId: string;
  pageText: string;
  quote: string;
  factId: string;
};

export const SYNTHETIC_EXECUTION_FIXTURES: readonly SyntheticExecutionFixture[] = [
  {
    fixtureId: "fixture:record-a",
    hiveId: "11111111-1111-4111-8111-111111111111",
    documentId: "33333333-3333-4333-8333-333333333333",
    pageText: "The meeting date is March 1 2024 and the room is North.",
    quote: "The meeting date is March 1 2024",
    factId: "fact:value",
  },
  {
    fixtureId: "fixture:record-b",
    hiveId: "22222222-2222-4222-8222-222222222222",
    documentId: "44444444-4444-4444-8444-444444444444",
    pageText: filingRecordPage.pageText,
    quote: filingRecordPage.quote,
    factId: "fact:value",
  },
  {
    fixtureId: "fixture:record-c",
    hiveId: "55555555-5555-4555-8555-555555555555",
    documentId: "66666666-6666-4666-8666-666666666666",
    pageText: "The application was signed on March 3 2024 in room West.",
    quote: "The application was signed on March 3 2024",
    factId: "fact:value",
  },
];

/**
 * A multi-page corpus is identified by the exact set of page-text digests.
 * A hive id is required only when one is recorded here. Development mode is not an entry.
 * `fixture:synthetic-maya` is the twelve pages of the synthetic L001 corpus in the form Rebuild
 * stores: the reader native text after newline normalization, per-line trailing-space removal,
 * and a full strip. Those texts are `eval/corpora/special-ed-l001/reader-pages`. A different
 * extractor, a different page, a missing page, or an extra page does not match.
 */
export const SYNTHETIC_MAYA_FIXTURE_ID = "fixture:synthetic-maya" as const;

export const SYNTHETIC_MAYA_PAGE_DIGESTS = [
  "0b08a7c649a2e176d19a827a7b0bee278a1030a1ae61cd2d625d2303fd8078db",
  "336d11d191755b8791bdba86d21f87a724f119a1c9bfe9ea769bac4594f5bff9",
  "4268a64de2a3d9f4c76dec5077b09273ef10cc1da39a3ed2a57d6b1063551945",
  "517d7ed7e98566377dd00257f89c3ee1481f78e802dd07fa188459b56a301a0b",
  "55b96b1ca1fb2691423fd884b7b71dfca3b7fc2c685187928a3bda5ebb510928",
  "55e91797bbbc9cf3b2273ef9ce5752f1210a9377766c99ae16489aeb79ec66f5",
  "a067daf017bbe757cb584b93c501d447ce4799db89e4dd3ec1a71f52db5f19cd",
  "a2d8e440c2af371f2f688e05965ee27dea89c90e08d960506a49047d5aa22629",
  "a6bfb41610d4fd45b0603d417c9f914c52b8458ba4b54d2ed98af80f2227ef5b",
  "bea443501abf7a863cc765b8b9d5afe15baaf22495b759f0d04300fae37dd96b",
  "c95b7c9d648262dc049af5ac9e647e42d7854f7c2c1adb30a74cb2afc5c6649f",
  "fad3324621c3046142bee28b9d7e690b80c414d4d422dcdb7acf127b78282c7a",
] as const;

export type SyntheticExecutionCorpus = {
  fixtureId: string;
  /** When set, the hive id must match. When null, the page texts alone identify the corpus. */
  hiveId: string | null;
  pageDigests: readonly string[];
};

export const SYNTHETIC_EXECUTION_CORPORA: readonly SyntheticExecutionCorpus[] = [
  {
    fixtureId: SYNTHETIC_MAYA_FIXTURE_ID,
    hiveId: null,
    pageDigests: SYNTHETIC_MAYA_PAGE_DIGESTS,
  },
];

export type SyntheticFixtureRefusal =
  | "synthetic_fixture_required"
  | "synthetic_fixture_mismatch"
  | "recorded_authorization_not_disclosure";

export function syntheticExecutionFixture(fixtureId: string): SyntheticExecutionFixture | null {
  return SYNTHETIC_EXECUTION_FIXTURES.find((fixture) => fixture.fixtureId === fixtureId) ?? null;
}

export function syntheticExecutionCorpus(fixtureId: string): SyntheticExecutionCorpus | null {
  return SYNTHETIC_EXECUTION_CORPORA.find((corpus) => corpus.fixtureId === fixtureId) ?? null;
}

function textDigest(text: string): string {
  return computeSha256Digest(text).slice("sha256:".length);
}

function pageMatches(fixture: SyntheticExecutionFixture, pages: readonly FrozenCasePage[]): boolean {
  if (pages.length !== 1) return false;
  const page = pages[0];
  if (!page || page.pageNumber !== 1) return false;
  if (page.documentId.toLowerCase() !== fixture.documentId) return false;
  if (page.text !== fixture.pageText) return false;
  const declared = normalizeContentDigest(page.sourcePageDigest);
  return declared === computeSha256Digest(fixture.pageText);
}

/**
 * Matches one registered fixture. `recordedAuthorization` does not select a fixture.
 * When it is set and the pages do not match, the refusal names that basis.
 */
function corpusMatches(corpus: SyntheticExecutionCorpus, pages: readonly FrozenCasePage[]): boolean {
  if (pages.length !== corpus.pageDigests.length) return false;
  const actual: string[] = [];
  for (const page of pages) {
    const digest = textDigest(page.text);
    const declared = normalizeContentDigest(page.sourcePageDigest);
    if (declared !== `sha256:${digest}`) return false;
    actual.push(digest);
  }
  actual.sort();
  const expected = [...corpus.pageDigests].sort();
  return actual.every((digest, index) => digest === expected[index]);
}

export function identifySyntheticExecutionFixture(input: {
  fixtureId: string;
  hiveId: string;
  pages: readonly FrozenCasePage[];
  recordedAuthorization: boolean;
}): { ok: true; fixtureId: string } | { ok: false; reason: SyntheticFixtureRefusal } {
  const corpus = syntheticExecutionCorpus(input.fixtureId);
  if (corpus) {
    const hiveMatches = corpus.hiveId === null || input.hiveId.toLowerCase() === corpus.hiveId;
    if (!hiveMatches || !corpusMatches(corpus, input.pages)) {
      return {
        ok: false,
        reason: input.recordedAuthorization ? "recorded_authorization_not_disclosure" : "synthetic_fixture_mismatch",
      };
    }
    return { ok: true, fixtureId: corpus.fixtureId };
  }
  const fixture = syntheticExecutionFixture(input.fixtureId);
  if (!fixture) {
    return {
      ok: false,
      reason: input.recordedAuthorization ? "recorded_authorization_not_disclosure" : "synthetic_fixture_required",
    };
  }
  if (input.hiveId.toLowerCase() !== fixture.hiveId || !pageMatches(fixture, input.pages)) {
    return {
      ok: false,
      reason: input.recordedAuthorization ? "recorded_authorization_not_disclosure" : "synthetic_fixture_mismatch",
    };
  }
  return { ok: true, fixtureId: fixture.fixtureId };
}

/** The closed registry entry for these pages, if any. A caller flag and the process environment are not consulted. */
export function resolveSyntheticExecutionFixtureId(input: {
  hiveId: string;
  pages: readonly FrozenCasePage[];
}): string | null {
  const ids = [
    ...SYNTHETIC_EXECUTION_FIXTURES.map((fixture) => fixture.fixtureId),
    ...SYNTHETIC_EXECUTION_CORPORA.map((corpus) => corpus.fixtureId),
  ];
  for (const fixtureId of ids) {
    const matched = identifySyntheticExecutionFixture({
      fixtureId,
      hiveId: input.hiveId,
      pages: input.pages,
      recordedAuthorization: false,
    });
    if (matched.ok) return matched.fixtureId;
  }
  return null;
}
