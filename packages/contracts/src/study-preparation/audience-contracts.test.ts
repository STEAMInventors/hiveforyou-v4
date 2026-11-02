import { describe, expect, it } from "vitest";

import {
  type AudienceAnalysis,
  parseAudienceAnalysis,
  parseAudienceChanges,
  resolveAudienceConfiguration,
} from "./audience-contracts";

const INTENT = "11111111-1111-4111-8111-111111111111";
const DOC = "33333333-3333-4333-8333-333333333333";
const sampled = new Set([`${DOC}#2`]);

const none = { kind: "NONE", statedAs: null, intentRequestId: null };

function audience(customer: Record<string, unknown>, pro: Record<string, unknown>) {
  return {
    customer: { tone: "Plain and practical", detailLevel: "PLAIN", ...customer },
    pro: { alternativeRoles: [], tone: "Evidence-first", detailLevel: "TECHNICAL", ...pro },
    studyGuidance: ["Keep every dated value with its source page"],
    writerGuidance: { customer: ["End with questions to ask"], pro: ["Compare source by source"] },
  };
}

function intentStage(intentText: string, raw: unknown, statedAudience: string | null = null) {
  return parseAudienceAnalysis(raw, { intents: [{ id: INTENT, intentText, audience: statedAudience }], stage: "INTENT" });
}

function intelligenceStage(intentText: string, raw: unknown) {
  return parseAudienceAnalysis(raw, { intents: [{ id: INTENT, intentText }], stage: "INTELLIGENCE", allowedRefs: sampled });
}

const MAYA = "I want to understand Maya's IEP, Prep for the IEP meeting and want to know if Maya is progressing";

describe("parseAudienceAnalysis", () => {
  it("accepts a provisional parent and an inferred advocate for Maya's IEP without inventing the person", () => {
    const result = intentStage(
      MAYA,
      audience(
        { role: "Parent or guardian", status: "PROVISIONAL", confidence: "MEDIUM", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
        {
          primaryRole: "Special education advocate",
          alternativeRoles: ["Special education attorney"],
          status: "INFERRED",
          confidence: "MEDIUM",
          basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null },
        },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customer).toMatchObject({ role: "Parent or guardian", status: "PROVISIONAL" });
    expect(result.value.pro.primaryRole).toBe("Special education advocate");
  });

  it("accepts a stated bankruptcy debtor quoted from the request", () => {
    const text = "I am the debtor in a Chapter 7 case. What does the trustee want from me?";
    const result = intentStage(
      text,
      audience(
        {
          role: "Debtor",
          status: "STATED",
          confidence: "HIGH",
          basis: { kind: "REQUEST_WORDING", statedAs: "I am the debtor", intentRequestId: INTENT },
        },
        { primaryRole: "Bankruptcy attorney", status: "INFERRED", confidence: "HIGH", basis: { kind: "REQUEST_WORDING", statedAs: "Chapter 7 case", intentRequestId: INTENT } },
      ),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a stated audience for a Medicaid application", () => {
    const result = intentStage(
      "Explain what this Medicaid denial means.",
      audience(
        { role: "Adult child helping a parent", status: "STATED", confidence: "HIGH", basis: { kind: "STATED_AUDIENCE", statedAs: "my mother's caregiver", intentRequestId: INTENT } },
        { primaryRole: "Elder-law attorney", alternativeRoles: ["Medicaid planner"], status: "INFERRED", confidence: "MEDIUM", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
      ),
      "my mother's caregiver",
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a quotation the person never wrote", () => {
    const result = intentStage(
      "Why was my insurance claim denied?",
      audience(
        { role: "Policyholder", status: "STATED", confidence: "HIGH", basis: { kind: "REQUEST_WORDING", statedAs: "I am the policyholder", intentRequestId: INTENT } },
        { primaryRole: "Public adjuster", status: "INFERRED", confidence: "MEDIUM", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
      ),
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "quotation_mismatch" });
  });

  it("rejects an inferred customer role without the person's words", () => {
    const result = intentStage(
      "Why was my insurance claim denied?",
      audience(
        { role: "Policyholder", status: "INFERRED", confidence: "MEDIUM", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
        { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
      ),
    );
    expect(result).toMatchObject({ ok: false, diagnosticReason: "audience_unsupported" });
  });

  it("accepts unknown roles and rejects an unknown role that still names someone", () => {
    const unknown = audience(
      { role: null, status: "UNKNOWN", confidence: "LOW", basis: none },
      { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
    );
    expect(intentStage("Summarize these documents.", unknown).ok).toBe(true);
    const named = audience(
      { role: "Tenant", status: "UNKNOWN", confidence: "LOW", basis: none },
      { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
    );
    expect(intentStage("Summarize these documents.", named)).toMatchObject({ ok: false, diagnosticReason: "audience_role_invalid" });
  });

  it("rejects a role with no basis and a provisional role with high confidence", () => {
    const noBasis = audience(
      { role: "Parent", status: "PROVISIONAL", confidence: "LOW", basis: none },
      { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
    );
    expect(intentStage(MAYA, noBasis)).toMatchObject({ ok: false, diagnosticReason: "audience_unsupported" });
    const overconfident = audience(
      { role: "Parent", status: "PROVISIONAL", confidence: "HIGH", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
      { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
    );
    expect(intentStage(MAYA, overconfident)).toMatchObject({ ok: false, diagnosticReason: "audience_confidence_invalid" });
  });

  it("forbids document context before the documents are seen", () => {
    const raw = audience(
      { role: "Parent", status: "PROVISIONAL", confidence: "LOW", basis: { kind: "DOCUMENT_CONTEXT", statedAs: null, intentRequestId: null, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 2 }] } },
      { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
    );
    expect(intentStage(MAYA, raw)).toMatchObject({ ok: false, diagnosticReason: "audience_basis_invalid" });
  });

  it("lets document context make a customer role provisional only, on sampled pages only", () => {
    const pro = { primaryRole: "Special education advocate", status: "INFERRED", confidence: "MEDIUM", basis: { kind: "DOCUMENT_CONTEXT", statedAs: null, intentRequestId: null, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 2 }] } };
    const provisional = audience(
      { role: "Parent or guardian", status: "PROVISIONAL", confidence: "MEDIUM", basis: { kind: "DOCUMENT_CONTEXT", statedAs: null, intentRequestId: null, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 2 }] } },
      pro,
    );
    expect(intelligenceStage(MAYA, provisional).ok).toBe(true);
    const inferred = audience(
      { role: "Parent", status: "INFERRED", confidence: "MEDIUM", basis: { kind: "DOCUMENT_CONTEXT", statedAs: null, intentRequestId: null, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 2 }] } },
      pro,
    );
    expect(intelligenceStage(MAYA, inferred)).toMatchObject({ ok: false, diagnosticReason: "audience_unsupported" });
    const unsampled = audience(
      { role: null, status: "UNKNOWN", confidence: "LOW", basis: none },
      { ...pro, basis: { ...pro.basis, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 9 }] } },
    );
    expect(intelligenceStage(MAYA, unsampled)).toMatchObject({ ok: false, diagnosticReason: "evidence_ref_invalid" });
  });

  it("rejects an ambiguous pro list that repeats the primary role", () => {
    const raw = audience(
      { role: null, status: "UNKNOWN", confidence: "LOW", basis: none },
      { primaryRole: "Insurance attorney", alternativeRoles: ["insurance attorney"], status: "PROVISIONAL", confidence: "LOW", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
    );
    expect(intentStage("Why was my claim denied?", raw)).toMatchObject({ ok: false, diagnosticReason: "duplicate_id" });
  });
});

describe("audience changes and configuration", () => {
  it("validates change references against sampled pages", () => {
    expect(parseAudienceChanges([{ audience: "pro", change: "Narrowed to advocate", reason: "Page 2 is an IEP", contextRefs: [{ sourceDocumentId: DOC, pageNumber: 2 }] }], sampled).ok).toBe(true);
    expect(parseAudienceChanges([{ audience: "pro", change: "x", reason: "y", contextRefs: [{ sourceDocumentId: DOC, pageNumber: 5 }] }], sampled).ok).toBe(false);
  });

  it("prefers the refined audience, then the intent proposal, then a labelled fallback", () => {
    const refined = { customer: { role: "Parent" } } as unknown as AudienceAnalysis;
    const proposed = { customer: { role: "Guardian" } } as unknown as AudienceAnalysis;
    expect(resolveAudienceConfiguration({ analysis: { audienceAnalysis: proposed }, intelligence: { audience: refined } })).toMatchObject({
      source: "INTENT_INTELLIGENCE",
      customer: { role: "Parent" },
    });
    expect(resolveAudienceConfiguration({ analysis: { audienceAnalysis: proposed } }).source).toBe("INTENT_ANALYSIS");
    expect(resolveAudienceConfiguration({})).toMatchObject({ source: "FALLBACK", customer: { status: "UNKNOWN" }, pro: { status: "UNKNOWN" } });
  });
});
