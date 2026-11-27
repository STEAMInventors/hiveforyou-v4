/**
 * Domain vocabulary for synthetic pack-guided fixtures.
 * This directory is exempt from the domain-word lint. Scanned engines and tests import these
 * values so the words stay out of the domain-agnostic core.
 */

export const domainSourcePattern = /\b(iep|bankruptcy|medicaid|district)\b/i;

/** A proposal kind the parser must reject. It is not a supported kind. */
export const unknownProposalKind = "IEP";

export const filingRecordPage = {
  pageText: "The petition was filed on March 2 2024 in room East.",
  quote: "The petition was filed on March 2 2024",
} as const;

export const compilerPlan = {
  name: "IEP",
  packId: "synthetic-iep",
  proPackId: "synthetic-iep-pro",
  firmPackId: "synthetic-iep-firm",
  title: "Synthetic plan pack",
  hiveId: "11111111-1111-4111-8111-111111111111",
  documentUuid: "33333333-3333-4333-8333-333333333333",
  entityId: "entity:student",
  documentId: "document:plan",
  checkId: "check:meeting",
  spareCheckId: "check:spare",
  proCheckId: "check:pro-review",
  firmCheckId: "check:firm-review",
  dimension: { key: "framework", value: "idea" },
  form: "plan",
  pageText: "The meeting date is March 1 2024 and the room is North.",
  quote: "The meeting date is March 1 2024",
} as const;

export const compilerFiling = {
  name: "Bankruptcy",
  packId: "synthetic-bankruptcy",
  proPackId: "synthetic-bankruptcy-pro",
  firmPackId: "synthetic-bankruptcy-firm",
  title: "Synthetic petition pack",
  hiveId: "22222222-2222-4222-8222-222222222222",
  documentUuid: "44444444-4444-4444-8444-444444444444",
  entityId: "entity:debtor",
  documentId: "document:petition",
  checkId: "check:filed",
  spareCheckId: "check:spare-petition",
  proCheckId: "check:pro-means",
  firmCheckId: "check:firm-means",
  dimension: { key: "chapter", value: "7" },
  form: "petition",
  pageText: filingRecordPage.pageText,
  quote: filingRecordPage.quote,
} as const;

export const compilerBenefit = {
  name: "Medicaid",
  packId: "synthetic-medicaid",
  proPackId: "synthetic-medicaid-pro",
  firmPackId: "synthetic-medicaid-firm",
  title: "Synthetic benefit pack",
  hiveId: "55555555-5555-4555-8555-555555555555",
  documentUuid: "66666666-6666-4666-8666-666666666666",
  entityId: "entity:member",
  documentId: "document:application",
  checkId: "check:submitted",
  spareCheckId: "check:spare-application",
  proCheckId: "check:pro-eligibility",
  firmCheckId: "check:firm-eligibility",
  dimension: { key: "program", value: "waiver" },
  form: "application",
  pageText: "The application was signed on March 3 2024 in room West.",
  quote: "The application was signed on March 3 2024",
} as const;

export const enginePlan = {
  name: "IEP",
  packId: "synthetic-iep",
  platformPackId: "synthetic-iep-platform",
  proPackId: "synthetic-iep-pro",
  proPackId2: "synthetic-iep-pro-b",
  firmPackId: "synthetic-iep-firm",
  title: "Synthetic plan pack",
  hiveId: "11111111-1111-4111-8111-111111111111",
  documentUuid: "33333333-3333-4333-8333-333333333333",
  entityId: "entity:student",
  documentId: "document:plan",
  checkId: "check:meeting",
  spareCheckId: "check:spare",
  proCheckId: "check:pro-review",
  proCheckId2: "check:pro-second",
  platformTermId: "term:platform-label",
  termId: "term:plan",
  dimension: { key: "framework", value: "idea" },
  form: "plan",
  pageText: "The meeting date is March 1 2024 and the room is North.",
  quote: "The meeting date is March 1 2024",
} as const;

export const engineFiling = {
  name: "Bankruptcy",
  packId: "synthetic-bankruptcy",
  platformPackId: "synthetic-bankruptcy-platform",
  proPackId: "synthetic-bankruptcy-pro",
  proPackId2: "synthetic-bankruptcy-pro-b",
  firmPackId: "synthetic-bankruptcy-firm",
  title: "Synthetic petition pack",
  hiveId: "22222222-2222-4222-8222-222222222222",
  documentUuid: "44444444-4444-4444-8444-444444444444",
  entityId: "entity:debtor",
  documentId: "document:petition",
  checkId: "check:filed",
  spareCheckId: "check:spare-petition",
  proCheckId: "check:pro-means",
  proCheckId2: "check:pro-second-petition",
  platformTermId: "term:platform-petition",
  termId: "term:petition",
  dimension: { key: "chapter", value: "7" },
  form: "petition",
  pageText: filingRecordPage.pageText,
  quote: filingRecordPage.quote,
} as const;

export const engineBenefit = {
  name: "Medicaid",
  packId: "synthetic-medicaid",
  platformPackId: "synthetic-medicaid-platform",
  proPackId: "synthetic-medicaid-pro",
  proPackId2: "synthetic-medicaid-pro-b",
  firmPackId: "synthetic-medicaid-firm",
  title: "Synthetic benefit pack",
  hiveId: "55555555-5555-4555-8555-555555555555",
  documentUuid: "66666666-6666-4666-8666-666666666666",
  entityId: "entity:member",
  documentId: "document:application",
  checkId: "check:submitted",
  spareCheckId: "check:spare-application",
  proCheckId: "check:pro-eligibility",
  proCheckId2: "check:pro-second-benefit",
  platformTermId: "term:platform-benefit",
  termId: "term:benefit",
  dimension: { key: "program", value: "waiver" },
  form: "application",
  pageText: "The application was signed on March 3 2024 in room West.",
  quote: "The application was signed on March 3 2024",
  programToken: "medicaid",
  riderPackId: "synthetic-medicaid-rider",
} as const;

export const studyPlan = {
  name: "Maya IEP",
  packId: "synthetic-maya-iep",
  proPackId: "synthetic-maya-iep-pro",
  firmPackId: "synthetic-maya-iep-firm",
  hiveId: "11111111-1111-4111-8111-111111111111",
  documentUuid: "33333333-3333-4333-8333-333333333333",
  entityId: "entity:student",
  documentId: "document:plan",
  checkId: "check:meeting",
  proCheckId: "check:pro-review",
  firmCheckId: "check:firm-review",
  dimension: { key: "framework", value: "idea" },
  form: "plan",
  date: "2024-03-01",
  label: "North",
} as const;

export const studyFiling = {
  name: "Bankruptcy",
  packId: "synthetic-bankruptcy",
  proPackId: "synthetic-bankruptcy-pro",
  firmPackId: "synthetic-bankruptcy-firm",
  hiveId: "22222222-2222-4222-8222-222222222222",
  documentUuid: "44444444-4444-4444-8444-444444444444",
  entityId: "entity:debtor",
  documentId: "document:petition",
  checkId: "check:filed",
  proCheckId: "check:pro-means",
  firmCheckId: "check:firm-means",
  dimension: { key: "chapter", value: "seven" },
  form: "petition",
  date: "2024-03-02",
  label: "East",
} as const;

export const studyBenefit = {
  name: "Medicaid",
  packId: "synthetic-medicaid",
  proPackId: "synthetic-medicaid-pro",
  firmPackId: "synthetic-medicaid-firm",
  hiveId: "55555555-5555-4555-8555-555555555555",
  documentUuid: "66666666-6666-4666-8666-666666666666",
  entityId: "entity:member",
  documentId: "document:application",
  checkId: "check:submitted",
  proCheckId: "check:pro-eligibility",
  firmCheckId: "check:firm-eligibility",
  dimension: { key: "program", value: "waiver" },
  form: "application",
  date: "2024-03-03",
  label: "West",
} as const;

export const evidencePlan = {
  name: "IEP",
  documentUuid: "33333333-3333-4333-8333-333333333333",
  pageText: "The meeting date is March 1 2024 and the room is North.",
  quote: "The meeting date is March 1 2024",
} as const;

export const evidenceFiling = {
  name: "Bankruptcy",
  documentUuid: "44444444-4444-4444-8444-444444444444",
  pageText: filingRecordPage.pageText,
  quote: filingRecordPage.quote,
} as const;

export const evidenceBenefit = {
  name: "Medicaid",
  documentUuid: "66666666-6666-4666-8666-666666666666",
  pageText: "The application was signed on March 3 2024 in room West.",
  quote: "The application was signed on March 3 2024",
} as const;

export const canonicalizeCases = [
  { name: "IEP", fixtureIndex: 0, packId: "synthetic-iep", dimension: { key: "framework", value: "idea" } },
  { name: "Bankruptcy", fixtureIndex: 1, packId: "synthetic-bankruptcy", dimension: { key: "chapter", value: "7" } },
  { name: "Medicaid", fixtureIndex: 2, packId: "synthetic-medicaid", dimension: { key: "program", value: "waiver" } },
] as const;
