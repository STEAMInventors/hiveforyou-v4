import type { ReportAudience } from "@hiveforyou/contracts";

import { buildFixture, type FixtureInput, type ReportFixture, sentence } from "./fixture-builder";

const D1 = "c1300001-0000-4000-8000-000000000001";
const D2 = "c1300002-0000-4000-8000-000000000002";
const D3 = "c1300003-0000-4000-8000-000000000003";
const D4 = "c1300004-0000-4000-8000-000000000004";
const D5 = "c1300005-0000-4000-8000-000000000005";
const D6 = "c1300006-0000-4000-8000-000000000006";

const INPUT: FixtureInput = {
  hiveId: "c13c13c1-0000-4000-8000-000000000000",
  intent: "Will the amended plan be approved at the May hearing, and what could stop it?",
  documents: [
    {
      id: D1,
      fileName: "01_petition_schedules.pdf",
      pages: 35,
      canonical: { role: "SUPPORTING", typeInPlainWords: "Bankruptcy petition and schedules", date: "2026-03-02", version: null, chainPosition: null },
    },
    {
      id: D2,
      fileName: "02_chapter13_plan.pdf",
      pages: 2,
      canonical: { role: "ANCHOR", typeInPlainWords: "Repayment plan", date: "2026-03-02", version: null, chainPosition: 1 },
    },
    {
      id: D3,
      fileName: "03_trustee_objection.pdf",
      pages: 1,
      canonical: { role: "SUPPORTING", typeInPlainWords: "Trustee's objection to the plan", date: "2026-04-10", version: null, chainPosition: null },
    },
    {
      id: D4,
      fileName: "04_amended_plan.pdf",
      pages: 2,
      canonical: { role: "ANCHOR", typeInPlainWords: "Repayment plan, first amended", date: "2026-04-28", version: "First Amended", chainPosition: 2 },
    },
    {
      id: D5,
      fileName: "05_income_statement.pdf",
      pages: 1,
      canonical: { role: "SUPPORTING", typeInPlainWords: "Employer pay summary", date: "2026-02-27", version: null, chainPosition: null },
    },
    {
      id: D6,
      fileName: "06_creditor_letter.pdf",
      pages: 1,
      canonical: { role: "SUPPORTING", typeInPlainWords: "Mortgage servicer letter", date: "2026-04-02", version: null, chainPosition: null },
    },
  ],
  facts: [
    ["F1", D4, 1, "Plan payment", "monthly amount", "$640.00 per month for 60 months", "The Debtor will make regular payments to the Trustee of $640.00 per month for 60 months, for a total of $38,400.00."],
    ["F2", D2, 1, "Plan payment", "monthly amount", "$510.00 per month for 60 months", "The Debtor will make regular payments to the Trustee of $510.00 per month for 60 months, for a total of $30,600.00."],
    ["F3", D4, 1, "Amended plan", "replaces", "replaces the plan dated March 2, 2026 in its entirety", "This First Amended Plan replaces the plan dated March 2, 2026 in its entirety."],
    ["F4", D4, 1, "Mortgage arrearage", "amount cured", "$9,600.00", "The prepetition arrearage of $9,600.00 will be cured through the plan in equal monthly installments, without interest."],
    ["F5", D2, 1, "Mortgage arrearage", "amount cured", "$9,600.00", "The prepetition arrearage of $9,600.00 will be cured through the plan in equal monthly installments, without interest."],
    ["F6", D6, 1, "Mortgage arrearage", "amount stated", "$12,180.00", "Our records show that the prepetition arrearage on this loan as of March 2, 2026 is $12,180.00"],
    ["F7", D4, 1, "Car loan claim", "treatment", "$14,850.00", "The full claim of $14,850.00 will be paid as a secured claim with interest at 7.5% per year."],
    ["F8", D2, 1, "Car loan claim", "treatment", "$11,200.00", "The secured claim is limited to the value of the collateral, $11,200.00, paid with interest at 7.5% per year."],
    ["F9", D4, 1, "Priority tax claim", "amount", "$2,140.00", "The County of Westmarch Tax Collector priority claim of $2,140.00 will be paid in full through the plan."],
    ["F10", D1, 29, "Gross monthly wages", "amount", "$4,850.00", "Gross monthly wages, salary and commissions: $4,850.00"],
    ["F11", D5, 1, "Gross monthly wages", "six-month average", "$5,325.00", "Average gross monthly wages: $5,325.00"],
    ["F12", D4, 1, "Unsecured dividend", "estimate", "15%", "The estimated dividend to nonpriority unsecured creditors is 15%."],
    ["F13", D2, 1, "Unsecured dividend", "estimate", "12%", "The estimated dividend to nonpriority unsecured creditors is 12%."],
    ["F14", D3, 1, "Confirmation hearing", "date and time", "May 14, 2026 at 9:30 a.m.", "A hearing on confirmation and on this objection will be held on May 14, 2026 at 9:30 a.m. in Courtroom 3B."],
    ["F15", D3, 1, "Trustee objection", "relief requested", "deny confirmation unless the Debtor files an amended plan", "The Trustee asks the Court to deny confirmation unless the Debtor files an amended plan resolving these objections and provides the 2025 federal income tax return."],
    ["F16", D1, 1, "Petition", "date filed", "March 2, 2026", "Date petition filed: March 2, 2026"],
    ["F17", D6, 1, "Servicer position", "objection", "objects to any plan that does not provide for the full amount", "Cobalt Ridge Mortgage Servicing will file a proof of claim for $12,180.00 in arrears and objects to any plan that does not provide for the full amount."],
    ["F18", D3, 1, "Tax return", "status", "has not been provided to the Trustee", "Exhibit C was not attached to the plan and has not been provided to the Trustee."],
    ["F19", D4, 2, "Exhibit C", "status", "incorporated by reference as previously filed", "Exhibit C (2025 federal income tax return) is incorporated by reference as previously filed."],
    ["F20", D5, 1, "Overtime", "availability", "available on most weeks since August 2025", "Overtime has been available on most weeks since August 2025 and is expected to continue through 2026."],
    ["F21", D4, 1, "Mortgage payment", "monthly amount", "$1,560.00", "The Debtor will continue the regular monthly mortgage payment of $1,560.00 directly."],
  ],
  study: {
    domainLabel: "Consumer repayment case",
    spineSource: "ANCHOR_CHAIN",
    spine: [
      { id: "S1", label: "Plan payment of $640.00 per month for 60 months", kind: "commitment", status: "CURRENT", supportingFactIds: ["F1"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S2", label: "Original plan payment, replaced by the amended plan", kind: "commitment", status: "SUPERSEDED", supportingFactIds: ["F2"], contradictingFactIds: [], updatingFactIds: ["F1", "F3"], missing: [] },
      { id: "S3", label: "Cure of the mortgage arrearage through the plan", kind: "obligation", status: "CONFLICTED", supportingFactIds: ["F4", "F5"], contradictingFactIds: ["F6"], updatingFactIds: [], missing: [] },
      { id: "S4", label: "Car loan claim paid in full as secured at 7.5%", kind: "obligation", status: "CURRENT", supportingFactIds: ["F7"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S5", label: "Original car loan treatment, limited to the collateral value", kind: "obligation", status: "SUPERSEDED", supportingFactIds: ["F8"], contradictingFactIds: [], updatingFactIds: ["F7"], missing: [] },
      { id: "S6", label: "Priority tax claim paid in full", kind: "obligation", status: "SUPPORTED", supportingFactIds: ["F9"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S7", label: "Gross monthly wages", kind: "figure", status: "CONFLICTED", supportingFactIds: ["F10"], contradictingFactIds: ["F11"], updatingFactIds: [], missing: [] },
      { id: "S8", label: "Estimated dividend to unsecured claims", kind: "figure", status: "CURRENT", supportingFactIds: ["F12"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S9", label: "Original estimated dividend, replaced by the amended plan", kind: "figure", status: "SUPERSEDED", supportingFactIds: ["F13"], contradictingFactIds: [], updatingFactIds: ["F12"], missing: [] },
      { id: "S10", label: "Confirmation hearing", kind: "date", status: "SUPPORTED", supportingFactIds: ["F14"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S11", label: "Trustee objects to confirmation", kind: "claim", status: "OPEN", supportingFactIds: ["F15"], contradictingFactIds: [], updatingFactIds: [], missing: ["2025 federal income tax return (Exhibit C)"] },
      { id: "S12", label: "Petition filed", kind: "date", status: "SUPPORTED", supportingFactIds: ["F16"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S13", label: "Mortgage servicer will claim the full arrears and objects to the plan", kind: "claim", status: "OPEN", supportingFactIds: ["F17"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
    ],
    outsideSpine: [
      { id: "O1", statement: "Overtime has been available most weeks since August 2025 and is expected to continue.", factIds: ["F20"] },
      { id: "O2", statement: "The regular monthly mortgage payment continues to be paid directly, outside the plan.", factIds: ["F21"] },
    ],
    conflicts: [
      { id: "C1", statement: "Gross monthly wages: the schedules report $4,850.00; the employer pay summary reports a six-month average of $5,325.00.", factIds: ["F10", "F11"] },
      { id: "C2", statement: "Mortgage arrearage: the amended plan cures $9,600.00; the mortgage servicer states $12,180.00 as of March 2, 2026.", factIds: ["F4", "F6"] },
    ],
    timeline: [
      { date: "2026-02-27", asWritten: "February 27, 2026", statement: "Employer pay summary prepared.", factIds: ["F11"] },
      { date: "2026-03-02", asWritten: "March 2, 2026", statement: "Petition filed with the original plan.", factIds: ["F16", "F2"] },
      { date: "2026-04-02", asWritten: "April 2, 2026", statement: "Mortgage servicer states a larger arrearage than the plan cures.", factIds: ["F6"] },
      { date: "2026-04-10", asWritten: "April 10, 2026", statement: "Trustee objects to confirmation of the original plan.", factIds: ["F15"] },
      { date: "2026-04-28", asWritten: "April 28, 2026", statement: "First amended plan replaces the original plan.", factIds: ["F3"] },
      { date: "2026-05-14", asWritten: "May 14, 2026 at 9:30 a.m.", statement: "Confirmation hearing.", factIds: ["F14"] },
    ],
    gaps: [
      { id: "X1", statement: "The 2025 federal income tax return (Exhibit C) that both plans rely on is not among the documents; the trustee states it was never provided.", relatedSpineIds: ["S11"] },
      { id: "X2", statement: "No pay records after February 2026 are among the documents, so current income cannot be checked.", relatedSpineIds: ["S7"] },
    ],
  },
  referencedDocuments: [
    { sourceDocumentId: D2, description: "2025 federal income tax return (Exhibit C)", page: 2, quote: "The Debtor's 2025 federal income tax return is filed with this plan as Exhibit C." },
    { sourceDocumentId: D3, description: "2025 federal income tax return (Exhibit C)", page: 1, quote: "Section 9 of the plan states that the Debtor's 2025 federal income tax return is filed as Exhibit C." },
    { sourceDocumentId: D4, description: "Exhibit C (2025 federal income tax return)", page: 2, quote: "Exhibit C (2025 federal income tax return) is incorporated by reference as previously filed." },
    { sourceDocumentId: D6, description: "Proof of claim", page: 1, quote: "will file a proof of claim for $12,180.00 in arrears" },
  ],
  writes: {
    CUSTOMER: {
      sections: [
        {
          heading: "Where your plan stands",
          paragraphs: [
            {
              sentences: [
                sentence("Your amended plan replaces the first plan completely and raises the monthly payment.", "F3", "F1", "F2"),
                sentence("It now pays the car loan in full, which is what the trustee asked for.", "F7", "F15"),
              ],
            },
          ],
        },
        {
          heading: "What could stop it",
          paragraphs: [
            {
              sentences: [
                sentence("The mortgage company says you are further behind than the plan covers, and it objects to any plan that does not pay the full amount.", "F6", "F17"),
                sentence("The income on your court forms is lower than your employer's pay summary shows, and the trustee says the two have not been reconciled.", "F10", "F11", "F15"),
                sentence("The trustee also says your 2025 tax return was never provided.", "F18"),
              ],
            },
          ],
        },
      ],
      blocks: ["conflicts", "spine_table", "gaps", "timeline", "documents"],
    },
    PRO: {
      sections: [
        {
          heading: "Plan chain and current terms",
          paragraphs: [
            {
              sentences: [
                sentence("The first amended plan expressly replaces the March 2 plan in its entirety, so the earlier payment, vehicle treatment and dividend are history rather than conflicts.", "F3"),
                sentence("The vehicle claim is now paid in full as secured, which answers the trustee's objection to the collateral-value treatment.", "F7", "F8", "F15"),
              ],
            },
          ],
        },
        {
          heading: "Open issues for confirmation",
          paragraphs: [
            {
              sentences: [
                sentence("Schedule I wages have not been reconciled with the employer's six-month average, which bears on projected disposable income.", "F10", "F11", "F15"),
                sentence("The servicer will file a claim for arrears above the amount the plan cures and objects to any plan that does not provide for it.", "F17", "F4"),
                sentence("Exhibit C is incorporated by reference, but the trustee states it has not been provided.", "F19", "F18"),
              ],
            },
          ],
        },
      ],
      blocks: ["spine_table", "conflicts", "gaps", "timeline", "documents", "outside_spine"],
    },
  },
};

export function bankruptcyC13Fixture(audience: ReportAudience): ReportFixture {
  return buildFixture(INPUT, audience);
}
