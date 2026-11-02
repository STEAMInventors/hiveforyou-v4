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
          status: "PROVISIONAL",
          confidence: "MEDIUM",
          basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null },
        },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customer).toMatchObject({ role: "Parent or guardian", status: "PROVISIONAL" });
    expect(result.value.pro).toMatchObject({ primaryRole: "Special education advocate", status: "PROVISIONAL" });
  });

  it("accepts a stated customer role even when the quotation does not name that role (no MODEL_OUTPUT_INVALID)", () => {
    const result = intentStage(
      MAYA,
      audience(
        {
          role: "Parent or guardian",
          status: "STATED",
          confidence: "HIGH",
          basis: { kind: "REQUEST_WORDING", statedAs: "Maya's IEP", intentRequestId: INTENT },
        },
        { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customer.role).toBe("Parent or guardian");
    expect(result.value.customer.status).toBe("STATED");
  });

  it("accepts an inferred professional role from the glossary at the intent stage", () => {
    const result = intentStage(
      MAYA,
      audience(
        { role: null, status: "UNKNOWN", confidence: "LOW", basis: none },
        {
          primaryRole: "Special education advocate",
          status: "INFERRED",
          confidence: "MEDIUM",
          basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null },
        },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pro.primaryRole).toBe("Special education advocate");
  });

  it("promotes a professional role listed only under alternativeRoles", () => {
    const result = intentStage(
      MAYA,
      audience(
        { role: null, status: "UNKNOWN", confidence: "LOW", basis: none },
        {
          primaryRole: null,
          alternativeRoles: ["Special education advocate"],
          status: "INFERRED",
          confidence: "MEDIUM",
          basis: { kind: "REQUEST_WORDING", statedAs: "IEP meeting", intentRequestId: INTENT },
        },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pro).toMatchObject({
      primaryRole: "Special education advocate",
      alternativeRoles: [],
      status: "INFERRED",
    });
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
        {
          primaryRole: "Elder-law attorney",
          alternativeRoles: ["Medicaid planner"],
          status: "PROVISIONAL",
          confidence: "MEDIUM",
          basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null },
        },
      ),
      "my mother's caregiver",
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a quotation the person never wrote without failing the workflow", () => {
    const result = intentStage(
      "Why was my insurance claim denied?",
      audience(
        { role: "Policyholder", status: "STATED", confidence: "HIGH", basis: { kind: "REQUEST_WORDING", statedAs: "I am the policyholder", intentRequestId: INTENT } },
        { primaryRole: "Public adjuster", status: "INFERRED", confidence: "MEDIUM", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customer.role).toBe("Policyholder");
  });

  it("accepts an inferred customer role from the glossary", () => {
    const result = intentStage(
      "Why was my insurance claim denied?",
      audience(
        { role: "Policyholder", status: "INFERRED", confidence: "MEDIUM", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
        { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customer).toMatchObject({ role: "Policyholder", status: "INFERRED" });
  });

  it("allows unknown customer while a pro audience is identified", () => {
    const result = intentStage(
      "Why was my insurance claim denied?",
      audience(
        { role: null, status: "UNKNOWN", confidence: "LOW", basis: none },
        {
          primaryRole: "Public adjuster",
          status: "INFERRED",
          confidence: "MEDIUM",
          basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null },
        },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customer.status).toBe("UNKNOWN");
    expect(result.value.pro.primaryRole).toBe("Public adjuster");
  });

  it("normalizes unknown status with a named role and provisional overconfidence", () => {
    const unknown = audience(
      { role: null, status: "UNKNOWN", confidence: "LOW", basis: none },
      { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
    );
    expect(intentStage("Summarize these documents.", unknown).ok).toBe(true);

    const namedUnknown = audience(
      { role: "Tenant", status: "UNKNOWN", confidence: "LOW", basis: none },
      { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
    );
    const cleared = intentStage("Summarize these documents.", namedUnknown);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.customer).toMatchObject({ role: null, status: "UNKNOWN" });

    const noBasis = audience(
      { role: "Parent", status: "PROVISIONAL", confidence: "LOW", basis: none },
      { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
    );
    const withBasis = intentStage(MAYA, noBasis);
    expect(withBasis.ok).toBe(true);
    if (!withBasis.ok) return;
    expect(withBasis.value.customer.basis.kind).toBe("GLOSSARY");

    const overconfident = audience(
      { role: "Parent", status: "PROVISIONAL", confidence: "HIGH", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
      { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
    );
    const clamped = intentStage(MAYA, overconfident);
    expect(clamped.ok).toBe(true);
    if (!clamped.ok) return;
    expect(clamped.value.customer.confidence).toBe("MEDIUM");
  });

  it("forbids document context before the documents are seen", () => {
    const raw = audience(
      { role: "Parent", status: "PROVISIONAL", confidence: "LOW", basis: { kind: "DOCUMENT_CONTEXT", statedAs: null, intentRequestId: null, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 2 }] } },
      { primaryRole: null, status: "UNKNOWN", confidence: "LOW", basis: none },
    );
    expect(intentStage(MAYA, raw)).toMatchObject({ ok: false, diagnosticReason: "audience_basis_invalid" });
  });

  it("lets document context refine audiences on sampled pages only", () => {
    const pro = { primaryRole: "Special education advocate", status: "INFERRED", confidence: "MEDIUM", basis: { kind: "DOCUMENT_CONTEXT", statedAs: null, intentRequestId: null, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 2 }] } };
    const provisional = audience(
      { role: "Parent or guardian", status: "PROVISIONAL", confidence: "MEDIUM", basis: { kind: "DOCUMENT_CONTEXT", statedAs: null, intentRequestId: null, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 2 }] } },
      pro,
    );
    expect(intelligenceStage(MAYA, provisional).ok).toBe(true);

    const inferredCustomer = audience(
      { role: "Parent", status: "INFERRED", confidence: "MEDIUM", basis: { kind: "DOCUMENT_CONTEXT", statedAs: null, intentRequestId: null, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 2 }] } },
      pro,
    );
    const normalized = intelligenceStage(MAYA, inferredCustomer);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.customer.status).toBe("PROVISIONAL");

    const unsampled = audience(
      { role: null, status: "UNKNOWN", confidence: "LOW", basis: none },
      { ...pro, basis: { ...pro.basis, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 9 }] } },
    );
    const droppedRefs = intelligenceStage(MAYA, unsampled);
    expect(droppedRefs.ok).toBe(true);
    if (!droppedRefs.ok) return;
    expect(droppedRefs.value.pro.basis).toMatchObject({ kind: "NONE", contextRefs: [] });
    expect(droppedRefs.value.pro.primaryRole).toBe("Special education advocate");
    expect(droppedRefs.value.pro.status).toBe("INFERRED");
  });

  it("keeps LLM roles when DOCUMENT_CONTEXT has no valid refs without inventing glossary basis (regression)", () => {
    const emptyDocContext = {
      kind: "DOCUMENT_CONTEXT" as const,
      statedAs: null,
      intentRequestId: null,
      contextRefs: [] as { sourceDocumentId: string; pageNumber: number }[],
    };
    const result = intelligenceStage(
      MAYA,
      audience(
        { role: "Parent or guardian", status: "PROVISIONAL", confidence: "MEDIUM", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
        {
          primaryRole: "Special education advocate",
          alternativeRoles: ["Special education attorney"],
          status: "INFERRED",
          confidence: "MEDIUM",
          basis: emptyDocContext,
        },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pro).toMatchObject({
      primaryRole: "Special education advocate",
      alternativeRoles: ["Special education attorney"],
      status: "INFERRED",
      basis: { kind: "NONE", statedAs: null, intentRequestId: null, contextRefs: [] },
    });

    const invalidRefs = intelligenceStage(
      MAYA,
      audience(
        { role: "Parent or guardian", status: "PROVISIONAL", confidence: "MEDIUM", basis: emptyDocContext },
        {
          primaryRole: "Special education advocate",
          status: "INFERRED",
          confidence: "MEDIUM",
          basis: { kind: "DOCUMENT_CONTEXT", statedAs: null, intentRequestId: null, contextRefs: [{ sourceDocumentId: DOC, pageNumber: 99 }] },
        },
      ),
    );
    expect(invalidRefs.ok).toBe(true);
    if (!invalidRefs.ok) return;
    expect(invalidRefs.value.customer.role).toBe("Parent or guardian");
    expect(invalidRefs.value.pro.basis.kind).toBe("NONE");
  });

  it("deduplicates an ambiguous pro list that repeats the primary role", () => {
    const raw = audience(
      { role: null, status: "UNKNOWN", confidence: "LOW", basis: none },
      { primaryRole: "Insurance attorney", alternativeRoles: ["insurance attorney"], status: "PROVISIONAL", confidence: "LOW", basis: { kind: "GLOSSARY", statedAs: null, intentRequestId: null } },
    );
    const result = intentStage("Why was my claim denied?", raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pro.alternativeRoles).toEqual([]);
  });
});

describe("audience changes and configuration", () => {
  it("keeps audience change refs when sampled and drops refs that were not provided", () => {
    expect(parseAudienceChanges([{ audience: "pro", change: "Narrowed to advocate", reason: "Page 2 is an IEP", contextRefs: [{ sourceDocumentId: DOC, pageNumber: 2 }] }], sampled).ok).toBe(true);
    const unsampled = parseAudienceChanges([{ audience: "pro", change: "x", reason: "y", contextRefs: [{ sourceDocumentId: DOC, pageNumber: 5 }] }], sampled);
    expect(unsampled.ok).toBe(true);
    if (!unsampled.ok) return;
    expect(unsampled.value[0]!.contextRefs).toEqual([]);
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
