import { describe, expect, it } from "vitest";
import { canonicalPackJson, packDigest } from "./domain-pack-compiler";
import { UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA } from "./domain-investigation-binder";
import { investigationEvidenceDigest } from "./domain-investigation-ledger";
import {
  EVIDENCE_PIN_ARTIFACT_RETRIEVAL,
  INVESTIGATION_EVIDENCE_PIN_SCHEMA,
  type InvestigationEvidencePin,
} from "./domain-investigation-evidence-pin";
import { DOMAIN_INVESTIGATION_PLAN_SCHEMA } from "./domain-investigation-plan";
import { VERIFIED_CASE_FACTS_SCHEMA, type VerifiedCaseFacts } from "./domain-pack-rules";
import { DOMAIN_PACK_RUNTIME_SCHEMA } from "./domain-pack-source";
import {
  EVIDENCE_PIN_AUDIT_METADATA_KEYS,
  investigationEvidencePinAuditMetadata,
  investigationEvidencePinCanonicalJson,
  investigationEvidencePinWrite,
  parseInvestigationEvidencePinReceipt,
  relationshipVerificationChainHead,
  relationshipVerificationChainHeadCanonicalJson,
  relationshipVerificationChainHeadId,
  sha256Utf8,
} from "./domain-investigation-evidence-pin-persistence";

const HIVE_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const REQUEST_ID = "cccccccc-0000-4000-8000-000000000001";
const DOC_ID = "dddddddd-0000-4000-8000-000000000001";
const QUOTE = "SECRET QUOTATION";
const PAGE_TEXT = "North page one.";

const PACK_CANONICAL = canonicalPackJson({
  schema: DOMAIN_PACK_RUNTIME_SCHEMA,
  identity: { packId: "pack.test", version: "0.0.1" },
});
const PLAN_CANONICAL = canonicalPackJson({ schema: DOMAIN_INVESTIGATION_PLAN_SCHEMA });

function pinWith(quote: string): InvestigationEvidencePin {
  const sourceGenerations = [
    {
      sourceDocumentId: DOC_ID,
      sourceSha256: "a".repeat(64),
      readFingerprint: "b".repeat(64),
      pageSetDigest: "sha256:" + "c".repeat(64),
      pageCount: 1,
      pages: [{ pageNumber: 1, pageTextSha256: "sha256:" + "d".repeat(64) }],
    },
  ];
  const verified: VerifiedCaseFacts = {
    schema: VERIFIED_CASE_FACTS_SCHEMA,
    coverage: "INCOMPLETE",
    facts: [
      {
        id: "F-b",
        status: "VERIFIED",
        entityId: "entity.one",
        instanceId: "inst-1",
        fieldId: "field.one",
        value: { valueType: "TEXT", value: quote },
        sourceRefs: [{ documentId: DOC_ID, page: "1", excerptId: "excerpt-1" }],
      },
      {
        id: "F-a",
        status: "VERIFIED",
        entityId: "entity.one",
        instanceId: "inst-1",
        fieldId: "field.two",
        value: { valueType: "TEXT", value: "other" },
        sourceRefs: [{ documentId: DOC_ID, page: "1", excerptId: "excerpt-2" }],
      },
    ],
    documents: [],
    relationships: [],
    conflicts: [],
  };
  const unresolved = { schema: UNRESOLVED_INVESTIGATION_CANDIDATES_SCHEMA, candidates: [] };
  const body = {
    schema: INVESTIGATION_EVIDENCE_PIN_SCHEMA,
    artifacts: {
      pack: {
        retrieval: EVIDENCE_PIN_ARTIFACT_RETRIEVAL,
        schema: DOMAIN_PACK_RUNTIME_SCHEMA,
        packId: "pack.test",
        version: "0.0.1",
        digest: sha256Utf8(PACK_CANONICAL),
      },
      plan: {
        retrieval: EVIDENCE_PIN_ARTIFACT_RETRIEVAL,
        schema: DOMAIN_INVESTIGATION_PLAN_SCHEMA,
        digest: sha256Utf8(PLAN_CANONICAL),
      },
    },
    extractionDigest: "e".repeat(64),
    binderDigest: packDigest({ verified, unresolved }),
    evidenceDigest: investigationEvidenceDigest(verified, unresolved),
    sourceGenerationsDigest: packDigest(sourceGenerations),
    verified,
    unresolved,
    sourceGenerations,
  };
  return { ...body, pinId: sha256Utf8(canonicalPackJson(body)) };
}

describe("investigation evidence pin persistence", () => {
  it("locks canonical json to sorted keys and JSON string escaping", () => {
    expect(PACK_CANONICAL).toBe(
      '{"identity":{"packId":"pack.test","version":"0.0.1"},"schema":"hive.domain-pack-runtime/1"}',
    );
    expect(canonicalPackJson({ b: 1, a: 'say "hi"' })).toBe('{"a":"say \\"hi\\"","b":1}');
    expect(canonicalPackJson({
      unresolved: { candidates: [], schema: "u" },
      verified: { facts: [{ id: "b" }, { id: "a" }], schema: "s" },
    })).toBe('{"unresolved":{"candidates":[],"schema":"u"},"verified":{"facts":[{"id":"b"},{"id":"a"}],"schema":"s"}}');
  });

  it("locks the sequence-zero chain head canonical preimage", () => {
    const head = relationshipVerificationChainHead({
      hiveId: "hive",
      pinId: "pin",
      packDigest: "pack",
      planDigest: "plan",
      extractionDigest: "x",
      binderDigest: "b",
      evidenceDigest: "e",
    });
    expect(relationshipVerificationChainHeadCanonicalJson(head)).toBe(
      '{"causalParentId":null,"evidenceRevision":{"binderDigest":"b","evidenceDigest":"e","extractionDigest":"x"},"hiveId":"hive","packDigest":"pack","pinId":"pin","planDigest":"plan","schema":"hive.relationship-verification-head/1","sequence":0}',
    );
    expect(head.sequence).toBe(0);
    expect(head.causalParentId).toBeNull();
    expect(relationshipVerificationChainHeadId(head)).toBe(sha256Utf8(relationshipVerificationChainHeadCanonicalJson(head)));
    expect(JSON.stringify(head)).not.toContain("quote");
  });

  it("sorts evidence before digesting it and keeps binder order unsorted", () => {
    const pin = pinWith(QUOTE);
    const sortedFacts = [...pin.verified.facts].sort((left, right) => left.id.localeCompare(right.id));
    expect(sortedFacts.map((fact) => fact.id)).toEqual(["F-a", "F-b"]);
    expect(pin.evidenceDigest).toBe(sha256Utf8(canonicalPackJson({
      verified: { ...pin.verified, facts: sortedFacts },
      unresolved: pin.unresolved,
    })));
    expect(pin.binderDigest).toBe(sha256Utf8(canonicalPackJson({
      verified: pin.verified,
      unresolved: pin.unresolved,
    })));
    expect(pin.evidenceDigest).not.toBe(pin.binderDigest);
  });

  it("builds a write whose pin id is the canonical preimage digest", () => {
    const pin = pinWith(QUOTE);
    const result = investigationEvidencePinWrite({
      hiveId: HIVE_ID.toUpperCase(),
      requestId: REQUEST_ID,
      pin,
      packCanonicalJson: PACK_CANONICAL,
      planCanonicalJson: PLAN_CANONICAL,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.hiveId).toBe(HIVE_ID);
    expect(sha256Utf8(result.write.pinCanonicalJson)).toBe(pin.pinId);
    expect(sha256Utf8(result.write.packCanonicalJson)).toBe(pin.artifacts.pack.digest);
    expect(sha256Utf8(result.write.planCanonicalJson)).toBe(pin.artifacts.plan.digest);
    expect(result.write.pinCanonicalJson).not.toContain("\"pinId\"");
    expect(result.chainHead.sequence).toBe(0);
    expect(result.chainHead.hiveId).toBe(HIVE_ID);
    expect(result.chainHeadId).toHaveLength(64);
  });

  it("keeps quotations out of audit metadata", () => {
    const pin = pinWith(QUOTE);
    const written = investigationEvidencePinWrite({
      hiveId: HIVE_ID,
      requestId: REQUEST_ID,
      pin,
      packCanonicalJson: PACK_CANONICAL,
      planCanonicalJson: PLAN_CANONICAL,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const metadata = investigationEvidencePinAuditMetadata({
      outcome: "created",
      hiveId: HIVE_ID,
      requestId: REQUEST_ID,
      pin,
      chainHeadId: written.chainHeadId,
    });
    expect(Object.keys(metadata).sort()).toEqual([...EVIDENCE_PIN_AUDIT_METADATA_KEYS].sort());
    const encoded = JSON.stringify(metadata);
    expect(encoded).not.toContain(QUOTE);
    expect(encoded).not.toContain(PAGE_TEXT);
    expect(encoded).not.toContain("excerpt-1");
    expect(metadata.sequence).toBe(0);
    expect(metadata.pinId).toBe(pin.pinId);
  });

  it("rejects altered artifact preimages, pin digest drift, and private receipt fields", () => {
    const pin = pinWith(QUOTE);
    const alteredPack = canonicalPackJson({
      schema: DOMAIN_PACK_RUNTIME_SCHEMA,
      identity: { packId: "pack.test", version: "0.0.2" },
    });
    expect(investigationEvidencePinWrite({
      hiveId: HIVE_ID,
      requestId: REQUEST_ID,
      pin,
      packCanonicalJson: alteredPack,
      planCanonicalJson: PLAN_CANONICAL,
    })).toEqual({ ok: false, code: "artifact_preimage_mismatch" });

    const withDigest = canonicalPackJson({
      schema: DOMAIN_PACK_RUNTIME_SCHEMA,
      identity: { packId: "pack.test", version: "0.0.1", digest: "a".repeat(64) },
    });
    expect(investigationEvidencePinWrite({
      hiveId: HIVE_ID,
      requestId: REQUEST_ID,
      pin,
      packCanonicalJson: withDigest,
      planCanonicalJson: PLAN_CANONICAL,
    })).toEqual({ ok: false, code: "artifact_preimage_invalid" });

    expect(investigationEvidencePinWrite({
      hiveId: HIVE_ID,
      requestId: REQUEST_ID,
      pin: { ...pin, pinId: "f".repeat(64) },
      packCanonicalJson: PACK_CANONICAL,
      planCanonicalJson: PLAN_CANONICAL,
    })).toEqual({ ok: false, code: "pin_digest_mismatch" });

    expect(investigationEvidencePinWrite({
      hiveId: "not-a-uuid",
      requestId: REQUEST_ID,
      pin,
      packCanonicalJson: PACK_CANONICAL,
      planCanonicalJson: PLAN_CANONICAL,
    })).toEqual({ ok: false, code: "invalid_request" });

    const written = investigationEvidencePinWrite({
      hiveId: HIVE_ID,
      requestId: REQUEST_ID,
      pin,
      packCanonicalJson: PACK_CANONICAL,
      planCanonicalJson: PLAN_CANONICAL,
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const receipt = {
      schema: "hive.investigation-evidence-pin-receipt/1",
      outcome: "created",
      hiveId: HIVE_ID,
      requestId: REQUEST_ID,
      pinId: pin.pinId,
      packDigest: pin.artifacts.pack.digest,
      planDigest: pin.artifacts.plan.digest,
      extractionDigest: pin.extractionDigest,
      binderDigest: pin.binderDigest,
      evidenceDigest: pin.evidenceDigest,
      sourceGenerationsDigest: pin.sourceGenerationsDigest,
      chainHead: { sequence: 0, recordId: written.chainHeadId, causalParentId: null },
    };
    expect(parseInvestigationEvidencePinReceipt(receipt)?.pinId).toBe(pin.pinId);
    expect(parseInvestigationEvidencePinReceipt({ ...receipt, quote: QUOTE })).toBeNull();
    expect(parseInvestigationEvidencePinReceipt({ ...receipt, verified: pin.verified })).toBeNull();
    expect(parseInvestigationEvidencePinReceipt({ ...receipt, chainHead: { ...receipt.chainHead, sequence: 1 } })).toBeNull();
    expect(JSON.stringify(receipt)).not.toContain(QUOTE);
  });
});
