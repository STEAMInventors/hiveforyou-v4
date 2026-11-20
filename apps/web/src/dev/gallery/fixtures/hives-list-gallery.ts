import { hiveAttention, type Hive, type HiveAttentionInput } from "@hiveforyou/contracts";

import type { HiveSummary } from "@/server/hives/hive-summary";

import { GALLERY_STAFF_ID } from "./board-messages";

export const GALLERY_FIRM_ID = "f0000000-0000-4000-8000-000000000099";

export const GALLERY_OTHER_STAFF_ID = "e0000000-0000-4000-8000-000000000003";

const ATTENTION_BASE: HiveAttentionInput = {
  documentCount: 4,
  unreadableDocumentCount: 0,
  documentsNotReadCount: 0,
  activeReadCount: 0,
  processingRunFailed: false,
  processingRunActive: false,
  documentsNotInStudyCount: 0,
  openConflicts: 0,
  openNeeds: 0,
  openChanged: 0,
  openMissing: 0,
  openChecked: 2,
  hasStudy: true,
  hasReport: true,
};

function hive(
  id: string,
  clientName: string,
  purpose: string,
  assignee: { id: string; name: string } | null,
  updatedAt: string,
): Hive {
  return {
    id,
    hiveId: id,
    name: clientName,
    description: purpose,
    kind: "client",
    clientRequestId: id,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt,
    isOwner: false,
    membershipRole: "professional",
    firmId: GALLERY_FIRM_ID,
    assigneeUserId: assignee?.id ?? null,
    assigneeDisplayName: assignee?.name ?? null,
    stage: "open",
  };
}

function summary(
  attention: Partial<HiveAttentionInput>,
  intake: { total: number; received: number } = { total: 9, received: 6 },
): HiveSummary {
  return {
    documentCount: attention.documentCount ?? ATTENTION_BASE.documentCount,
    intake,
    attention: hiveAttention({ ...ATTENTION_BASE, ...attention }),
    study: {
      revisionNumber: 2,
      acceptedAt: "2026-10-15T00:00:00.000Z",
      counts: null,
      targets: null,
      toReviewCount: attention.openNeeds ?? 0,
    },
  };
}

/** Nine client hives: all four list groups, two assignees, one unassigned, one without a summary. */
export const GALLERY_FIRM_HIVES: Hive[] = [
  hive(
    "a1000000-0000-4000-8000-000000000001",
    "Dana Ellis",
    "Medicaid five-year review",
    { id: GALLERY_STAFF_ID, name: "Priya Shah" },
    "2026-10-28T16:00:00.000Z",
  ),
  hive(
    "a1000000-0000-4000-8000-000000000002",
    "Ruth Rivera",
    "Estate planning intake",
    { id: GALLERY_STAFF_ID, name: "Priya Shah" },
    "2026-10-27T11:00:00.000Z",
  ),
  hive(
    "a1000000-0000-4000-8000-000000000003",
    "Sam Okonkwo",
    "Probate document gather",
    { id: GALLERY_OTHER_STAFF_ID, name: "Marcus Lee" },
    "2026-10-26T09:00:00.000Z",
  ),
  hive(
    "a1000000-0000-4000-8000-000000000004",
    "Jamie Chen",
    "Annual tax reconciliation",
    { id: GALLERY_STAFF_ID, name: "Priya Shah" },
    "2026-10-25T14:00:00.000Z",
  ),
  hive(
    "a1000000-0000-4000-8000-000000000005",
    "Alex Kim",
    "Business sale diligence",
    { id: GALLERY_OTHER_STAFF_ID, name: "Marcus Lee" },
    "2026-10-24T10:00:00.000Z",
  ),
  hive(
    "a1000000-0000-4000-8000-000000000006",
    "Taylor Brooks",
    "Divorce financial disclosure",
    { id: GALLERY_STAFF_ID, name: "Priya Shah" },
    "2026-10-23T08:00:00.000Z",
  ),
  hive(
    "a1000000-0000-4000-8000-000000000007",
    "Morgan Lee",
    "Special-needs trust review",
    { id: GALLERY_OTHER_STAFF_ID, name: "Marcus Lee" },
    "2026-10-22T17:00:00.000Z",
  ),
  hive(
    "a1000000-0000-4000-8000-000000000008",
    "Casey Park",
    "Guardianship annual report",
    { id: GALLERY_STAFF_ID, name: "Priya Shah" },
    "2026-10-20T12:00:00.000Z",
  ),
  hive(
    "a1000000-0000-4000-8000-000000000009",
    "Jordan Walsh",
    "Conservatorship accounting",
    null,
    "2026-10-19T15:00:00.000Z",
  ),
];

export const GALLERY_FIRM_SUMMARIES: Record<string, HiveSummary> = {
  "a1000000-0000-4000-8000-000000000001": summary({ openNeeds: 2, openChanged: 1 }),
  "a1000000-0000-4000-8000-000000000002": summary({ openConflicts: 1 }),
  "a1000000-0000-4000-8000-000000000004": summary({
    activeReadCount: 2,
    documentsNotReadCount: 3,
    documentCount: 6,
  }),
  "a1000000-0000-4000-8000-000000000005": summary(
    { processingRunActive: true, documentCount: 8 },
    { total: 8, received: 8 },
  ),
  "a1000000-0000-4000-8000-000000000006": summary({ openMissing: 3 }),
  "a1000000-0000-4000-8000-000000000007": summary({ documentCount: 0 }, { total: 9, received: 0 }),
  "a1000000-0000-4000-8000-000000000008": summary({ openChecked: 4 }),
  "a1000000-0000-4000-8000-000000000009": summary({ openChecked: 5 }),
};

export const GALLERY_OWN_HIVES: Hive[] = [
  {
    id: "b2000000-0000-4000-8000-000000000001",
    hiveId: "b2000000-0000-4000-8000-000000000001",
    name: "My tax records",
    description: "Personal returns and W-2s",
    kind: "own",
    clientRequestId: "b2000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    firmId: null,
    membershipRole: "owner",
    stage: "open",
  },
  {
    id: "b2000000-0000-4000-8000-000000000002",
    hiveId: "b2000000-0000-4000-8000-000000000002",
    name: "Parent's medical bills",
    description: "Hospital statements for 2024",
    kind: "own",
    clientRequestId: "b2000000-0000-4000-8000-000000000002",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
    firmId: null,
    membershipRole: "owner",
    stage: "open",
  },
  {
    id: "b2000000-0000-4000-8000-000000000003",
    hiveId: "b2000000-0000-4000-8000-000000000003",
    name: "Home repair invoices",
    description: "Roof and HVAC receipts",
    kind: "own",
    clientRequestId: "b2000000-0000-4000-8000-000000000003",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
    firmId: null,
    membershipRole: "owner",
    stage: "open",
  },
];

export const GALLERY_OWN_SUMMARIES: Record<string, HiveSummary> = {
  "b2000000-0000-4000-8000-000000000001": summary({ openNeeds: 1 }, { total: 4, received: 2 }),
  "b2000000-0000-4000-8000-000000000002": summary({ openMissing: 1 }, { total: 6, received: 3 }),
  "b2000000-0000-4000-8000-000000000003": summary({ openChecked: 2 }, { total: 0, received: 0 }),
};