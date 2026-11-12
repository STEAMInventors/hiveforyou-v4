import type { ReportAudience } from "@hiveforyou/contracts";

import { buildFixture, type FixtureInput, type ReportFixture, sentence } from "./fixture-builder";

const H1 = "40e10001-0000-4000-8000-000000000001";
const H2 = "40e10002-0000-4000-8000-000000000002";
const H3 = "40e10003-0000-4000-8000-000000000003";
const H4 = "40e10004-0000-4000-8000-000000000004";
const H5 = "40e10005-0000-4000-8000-000000000005";
const H6 = "40e10006-0000-4000-8000-000000000006";
const H7 = "40e10007-0000-4000-8000-000000000007";

const supporting = (typeInPlainWords: string, date: string | null) =>
  ({ role: "SUPPORTING", typeInPlainWords, date, version: null, chainPosition: null }) as const;

const INPUT: FixtureInput = {
  hiveId: "40e140e1-0000-4000-8000-000000000000",
  intent: "Do we have to pay the plumber's bill? What bills are coming up?",
  documents: [
    { id: H1, fileName: "01_electric_bill.pdf", pages: 1, canonical: supporting("Electric bill", "2026-08-04") },
    { id: H2, fileName: "02_water_bill.pdf", pages: 1, canonical: supporting("Water bill", "2026-08-25") },
    { id: H3, fileName: "03_insurance_renewal.pdf", pages: 1, canonical: supporting("Renters insurance renewal notice", "2026-08-01") },
    { id: H4, fileName: "04_lease_clause.pdf", pages: 1, canonical: supporting("Lease excerpt", null) },
    { id: H5, fileName: "05_repair_invoice.pdf", pages: 1, canonical: supporting("Plumbing repair invoice", "2026-08-15") },
    { id: H6, fileName: "06_email_leak_report.pdf", pages: 1, canonical: supporting("Tenant's email", "2026-08-14") },
    { id: H7, fileName: "07_email_reimbursement_request.pdf", pages: 1, canonical: supporting("Property manager's email", "2026-08-29") },
  ],
  facts: [
    ["E1", H1, 1, "Electric bill", "amount due", "$142.37", "Amount due: $142.37"],
    ["E2", H1, 1, "Electric bill", "due date", "August 22, 2026", "Payment due date: August 22, 2026"],
    ["E3", H2, 1, "Water bill", "amount due", "$88.60", "Amount due: $88.60"],
    ["E4", H2, 1, "Water bill", "due date", "September 15, 2026", "Payment due date: September 15, 2026"],
    ["E5", H2, 1, "Leak adjustment", "deadline", "within 60 days of the bill date", "If a leak has been repaired, you may ask for a leak adjustment within 60 days of the bill date and include a copy of the repair invoice."],
    ["E6", H3, 1, "Insurance premium", "annual amount", "$312.00", "Annual premium: $312.00"],
    ["E7", H3, 1, "Insurance premium", "prior annual amount", "$276.00", "Prior annual premium: $276.00"],
    ["E8", H3, 1, "Insurance premium", "due date", "September 1, 2026", "Premium due by: September 1, 2026"],
    ["E9", H4, 1, "Plumbing repairs", "who pays", "will pay for repairs to those systems", "14.1 Landlord will keep the plumbing, heating and electrical systems in good repair and will pay for repairs to those systems, except for damage caused by the negligence or misuse of Tenant or Tenant's guests."],
    ["E10", H4, 1, "Leak report", "deadline", "in writing within 48 hours", "14.2 Tenant must report any leak or plumbing problem to Landlord in writing within 48 hours after Tenant discovers it."],
    ["E11", H6, 1, "Leak report", "sent", "August 14, 2026, 8:12 a.m.", "Date: August 14, 2026, 8:12 a.m."],
    ["E12", H5, 1, "Repair invoice", "total", "$386.50", "Invoice total: $386.50"],
    ["E13", H5, 1, "Repair", "cause", "corrosion of the original fitting due to age", "Cause: corrosion of the original fitting due to age. No sign of damage or misuse."],
    ["E14", H7, 1, "Reimbursement request", "amount", "$468.50", "Per the plumber's invoice of $468.50, we are asking you to reimburse the full amount."],
    ["E15", H4, 1, "Lease", "term", "October 1, 2025 to September 30, 2026", "Lease term: October 1, 2025 to September 30, 2026"],
    ["E17", H7, 1, "Reimbursement request", "when", "add it to your September rent payment", "Please add it to your September rent payment."],
    ["E19", H3, 1, "Water damage cover", "scope", "sudden and accidental discharge of water", "This policy covers sudden and accidental discharge of water from a plumbing system."],
    ["E20", H4, 1, "Utilities", "who pays", "Tenant pays electricity and water directly", "Tenant pays electricity and water directly to the utility providers."],
  ],
  study: {
    domainLabel: "Household bills and a rental repair",
    spineSource: "PARTIES_AND_OBLIGATIONS",
    spine: [
      { id: "S1", label: "Electric bill due August 22, 2026", kind: "obligation", status: "SUPPORTED", supportingFactIds: ["E1", "E2"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S2", label: "Water bill due September 15, 2026", kind: "obligation", status: "SUPPORTED", supportingFactIds: ["E3", "E4"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S3", label: "Leak adjustment may be requested within 60 days of the water bill date", kind: "obligation", status: "SUPPORTED", supportingFactIds: ["E5"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S4", label: "Renters insurance premium due by September 1, 2026", kind: "figure", status: "SUPPORTED", supportingFactIds: ["E6", "E7", "E8"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S5", label: "Landlord pays for plumbing repairs unless caused by tenant negligence or misuse", kind: "obligation", status: "SUPPORTED", supportingFactIds: ["E9"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S6", label: "Tenant must report a leak in writing within 48 hours", kind: "obligation", status: "SUPPORTED", supportingFactIds: ["E10"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S7", label: "Leak reported to the property manager by email", kind: "date", status: "SUPPORTED", supportingFactIds: ["E11"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S8", label: "Repair invoice total; cause recorded as corrosion due to age", kind: "figure", status: "SUPPORTED", supportingFactIds: ["E12", "E13"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
      { id: "S9", label: "Property manager asks the tenants to reimburse the repair with September rent", kind: "claim", status: "CONFLICTED", supportingFactIds: ["E14", "E17"], contradictingFactIds: ["E12"], updatingFactIds: [], missing: [] },
      { id: "S10", label: "Lease term ends September 30, 2026", kind: "date", status: "SUPPORTED", supportingFactIds: ["E15"], contradictingFactIds: [], updatingFactIds: [], missing: [] },
    ],
    outsideSpine: [
      { id: "O1", statement: "The renters policy covers sudden and accidental discharge of water, not leakage over weeks or months.", factIds: ["E19"] },
      { id: "O2", statement: "The tenants pay electricity and water directly to the utilities.", factIds: ["E20"] },
    ],
    conflicts: [
      { id: "C1", statement: "Repair amount: the plumbing invoice totals $386.50; the property manager's email cites an invoice of $468.50.", factIds: ["E12", "E14"] },
    ],
    timeline: [
      { date: "2026-08-01", asWritten: "August 1, 2026", statement: "Insurance renewal notice: the annual premium rises.", factIds: ["E6", "E7"] },
      { date: "2026-08-14", asWritten: "August 14, 2026", statement: "Leak reported to the property manager by email.", factIds: ["E11"] },
      { date: "2026-08-15", asWritten: "August 15, 2026", statement: "Plumber replaces the corroded supply line.", factIds: ["E12", "E13"] },
      { date: "2026-08-22", asWritten: "August 22, 2026", statement: "Electric bill due.", factIds: ["E2"] },
      { date: "2026-08-29", asWritten: "August 29, 2026", statement: "Property manager asks for reimbursement with September rent.", factIds: ["E14", "E17"] },
      { date: "2026-09-01", asWritten: "September 1, 2026", statement: "Insurance premium due.", factIds: ["E8"] },
      { date: "2026-09-15", asWritten: "September 15, 2026", statement: "Water bill due.", factIds: ["E4"] },
      { date: "2026-09-30", asWritten: "September 30, 2026", statement: "Lease term ends.", factIds: ["E15"] },
    ],
    gaps: [
      {
        id: "X1",
        statement: "No single document governs this case; the study follows who owes what to whom and by when.",
        relatedSpineIds: [],
        kind: "OBSERVATION",
        title: "",
        why: "No single document governs this case; the study follows who owes what to whom and by when.",
        holder: "",
        holderType: null,
        when: null,
        basisType: null,
        relatedFactIds: [],
      },
      {
        id: "X2",
        statement: "The move-in inspection checklist (Exhibit B) that the lease says is attached is not among the documents, so the plumbing's condition at move-in cannot be checked.",
        relatedSpineIds: ["S5", "S9"],
        kind: "REQUESTABLE_DOCUMENT",
        title: "Move-in inspection checklist (Exhibit B)",
        why: "The lease says Exhibit B is attached, but the checklist is not in the case.",
        holder: "Landlord or property manager",
        holderType: "THIRD_PARTY",
        when: null,
        basisType: "MENTIONED",
        relatedFactIds: [],
      },
      {
        id: "X3",
        statement: "No request for a leak adjustment from the water utility is among the documents.",
        relatedSpineIds: ["S3"],
        kind: "REQUESTABLE_DOCUMENT",
        title: "Water utility leak adjustment request",
        why: "The utility rules allow a one-time adjustment after a documented leak repair.",
        holder: "Tenant",
        holderType: "ASKER_OR_CLIENT",
        when: null,
        basisType: "USUALLY_EXPECTED",
        relatedFactIds: ["E5"],
      },
    ],
  },
  referencedDocuments: [
    { sourceDocumentId: H4, description: "Move-in inspection checklist (Exhibit B)", page: 1, quote: "recorded in the move-in inspection checklist signed by Landlord and Tenants, attached as Exhibit B." },
  ],
  writes: {
    CUSTOMER: {
      sections: [
        {
          heading: "The repair bill",
          paragraphs: [
            {
              sentences: [
                sentence("Your lease says the landlord pays for plumbing repairs unless the damage came from your negligence or misuse.", "E9"),
                sentence("The plumber wrote that an old fitting corroded and found no sign of misuse.", "E13"),
                sentence("The property manager is asking for more than the plumber's invoice shows.", "E14", "E12"),
              ],
            },
            {
              sentences: [sentence("You reported the leak in writing the morning you found it, and the lease asks for that within 48 hours.", "E11", "E10")],
            },
          ],
        },
        {
          heading: "Bills coming up",
          paragraphs: [
            {
              sentences: [
                sentence("Your renters insurance costs more this year than last.", "E6", "E7"),
                sentence("The water utility lets you ask for a leak adjustment once a leak is repaired.", "E5"),
              ],
            },
          ],
        },
      ],
      blocks: ["conflicts", "timeline", "spine_table", "documents"],
      components: [{ name: "DocumentRequestList" }],
    },
    PRO: {
      sections: [
        {
          heading: "Repair cost allocation",
          paragraphs: [
            {
              sentences: [
                sentence("Lease section 14.1 places plumbing repairs on the landlord except for tenant negligence or misuse.", "E9"),
                sentence("The invoice attributes the leak to age-related corrosion and records no sign of misuse.", "E13"),
                sentence("The reimbursement request cites a figure that does not match the invoice total.", "E14", "E12"),
              ],
            },
          ],
        },
        {
          heading: "Notice and timing",
          paragraphs: [
            {
              sentences: [
                sentence("The written report went out on the day of discovery, inside the lease's 48-hour window.", "E11", "E10"),
                sentence("A leak adjustment must be requested within 60 days of the water bill date, with the repair invoice.", "E5"),
              ],
            },
          ],
        },
      ],
      blocks: ["spine_table", "conflicts", "timeline", "documents", "outside_spine"],
      components: [{ name: "DocumentRequestList" }],
    },
  },
};

export function noAnchorHouseholdFixture(audience: ReportAudience): ReportFixture {
  return buildFixture(INPUT, audience);
}
