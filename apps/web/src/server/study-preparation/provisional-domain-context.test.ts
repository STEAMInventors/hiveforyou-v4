import { describe, expect, it } from "vitest";

import {
  applyProvisionalDomainToIntentSystemPrompt,
  normalizeProvisionalDomainContext,
  parseProvisionalDomainContextFromInputs,
} from "./provisional-domain-context";

describe("provisional domain context", () => {
  it("defaults to Unknown with no glossary", () => {
    expect(normalizeProvisionalDomainContext(null)).toEqual({ label: "Unknown", glossary: null });
  });

  it("passes through optional label and glossary text", () => {
    expect(
      normalizeProvisionalDomainContext({
        label: " Special education / IEP ",
        glossary: "- IEP: Individualized Education Program.",
      }),
    ).toEqual({
      label: "Special education / IEP",
      glossary: "- IEP: Individualized Education Program.",
    });
  });

  it("substitutes placeholders in the intent system prompt", () => {
    const template = "Domain label: {{DOMAIN_LABEL_OR_UNKNOWN}}\nGlossary:\n{{DOMAIN_GLOSSARY}}";
    expect(
      applyProvisionalDomainToIntentSystemPrompt(template, {
        label: "Unknown",
        glossary: null,
      }),
    ).toContain("Domain label: Unknown");
    expect(applyProvisionalDomainToIntentSystemPrompt(template, { label: "Unknown", glossary: null })).toContain(
      "(No glossary supplied.)",
    );
  });

  it("reads optional provisionalDomainContext from worker inputs", () => {
    expect(parseProvisionalDomainContextFromInputs({})).toEqual({ label: "Unknown", glossary: null });
    expect(
      parseProvisionalDomainContextFromInputs({
        provisionalDomainContext: { label: "Tenancy", glossary: "Lease: a rental agreement." },
      }),
    ).toEqual({ label: "Tenancy", glossary: "Lease: a rental agreement." });
  });
});
