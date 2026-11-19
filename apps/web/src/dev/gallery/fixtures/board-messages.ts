import type { Hive, HiveMessage, HiveMessagePage } from "@hiveforyou/contracts";

const HIVE = "11111111-1111-4111-8111-111111111111";
const DANA_ID = "c0000000-0000-4000-8000-000000000001";
const PRIYA_ID = "d0000000-0000-4000-8000-000000000002";

export const GALLERY_HIVE_ID = HIVE;

export const GALLERY_CLIENT_ID = DANA_ID;
export const GALLERY_STAFF_ID = PRIYA_ID;

export const GALLERY_ASSISTANT_NAME = "Sarah";

function msg(partial: Partial<HiveMessage> & Pick<HiveMessage, "id" | "body" | "createdAt">): HiveMessage {
  return {
    authorKind: "person",
    authorRole: "client",
    authorUserId: DANA_ID,
    authorDisplayName: "Dana Ellis",
    authorRoleLabel: "Client",
    isMine: false,
    sourceRefs: [],
    replyToMessageId: null,
    handoffFromMessageId: null,
    triggerMessageId: null,
    ...partial,
  };
}

/** Conversation (people only — no assistant rows), staff viewer. */
export const GALLERY_PEOPLE_PAGE: HiveMessagePage = {
  messages: [
    msg({
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-10-28T14:05:00.000Z",
      authorRole: "staff",
      authorUserId: PRIYA_ID,
      authorDisplayName: "Priya Shah",
      authorRoleLabel: "Onboarding associate",
      isMine: true,
      body: "Welcome. I'll help organize the documents for the financial review. Send what you have now, even if some statements are missing.",
    }),
    msg({
      id: "00000000-0000-4000-8000-000000000002",
      createdAt: "2026-10-28T14:12:00.000Z",
      body: "I uploaded the bank statements I could find. I'm not sure whether the savings account was open in 2022.",
    }),
    msg({
      id: "00000000-0000-4000-8000-000000000003",
      createdAt: "2026-10-28T14:18:00.000Z",
      authorRole: "staff",
      authorUserId: PRIYA_ID,
      authorDisplayName: "Priya Shah",
      authorRoleLabel: "Onboarding associate",
      isMine: true,
      body: "Could you request the checking statements for April through June 2023? I'll keep that request open until they arrive.",
      sourceRefs: [
        { sourceDocumentId: "doc-checking", pageNumber: 4, shortLabel: "Checking stmts", factId: "f1" },
        { sourceDocumentId: "doc-checking", pageNumber: 5, shortLabel: "Checking stmts", factId: "f2" },
      ],
    }),
  ],
  participantRoleLabels: ["Client", "Onboarding associate"],
  participantCount: 2,
  viewerLastReadAt: null,
  nextCursor: null,
};

export const GALLERY_ASK_CLIENT_PAGE: HiveMessagePage = {
  messages: [
    msg({
      id: "00000000-0000-4000-8000-000000000010",
      createdAt: "2026-10-28T14:12:00.000Z",
      isMine: true,
      body: "I uploaded the bank statements I could find. I'm not sure whether the savings account was open in 2022.",
    }),
    {
      ...msg({
        id: "00000000-0000-4000-8000-000000000011",
        createdAt: "2026-10-28T14:13:00.000Z",
        body: "The earliest savings statement starts in January 2023, so the documents don't show whether the account was open in 2022. Priya can ask the bank for the opening date.",
      }),
      authorKind: "assistant",
      authorRole: "assistant",
      authorUserId: null,
      authorDisplayName: GALLERY_ASSISTANT_NAME,
      authorRoleLabel: "",
      sourceRefs: [
        { sourceDocumentId: "doc-savings", pageNumber: 1, shortLabel: "Savings stmts", factId: "f3" },
      ],
    },
    msg({
      id: "00000000-0000-4000-8000-000000000012",
      createdAt: "2026-10-28T14:20:00.000Z",
      isMine: true,
      body: "Can someone confirm whether Mom had this account before 2022?",
    }),
    {
      ...msg({
        id: "00000000-0000-4000-8000-000000000013",
        createdAt: "2026-10-28T14:21:00.000Z",
        body: "That's a question for Priya. I can pass it to her in the Conversation.",
      }),
      authorKind: "assistant",
      authorRole: "assistant",
      authorUserId: null,
      authorDisplayName: GALLERY_ASSISTANT_NAME,
      authorRoleLabel: "",
      assistantRunStatus: "routed",
      triggerMessageId: "00000000-0000-4000-8000-000000000012",
    },
  ],
  participantRoleLabels: [],
  participantCount: 1,
  viewerLastReadAt: null,
  nextCursor: null,
  assistantThreads: [
    {
      userId: DANA_ID,
      displayName: "Dana Ellis",
      roleLabel: "Client",
      messageCount: 2,
      lastAt: "2026-10-28T14:20:00.000Z",
    },
  ],
};

export const GALLERY_ASK_STAFF_READONLY_PAGE: HiveMessagePage = {
  ...GALLERY_ASK_CLIENT_PAGE,
  messages: GALLERY_ASK_CLIENT_PAGE.messages.map((row) => ({ ...row, isMine: false })),
};

export const GALLERY_ASK_EMPTY_PAGE: HiveMessagePage = {
  messages: [],
  participantRoleLabels: [],
  participantCount: 0,
  viewerLastReadAt: null,
  nextCursor: null,
};

const LONG_REF_DOC = "doc-checking";

export function longMessagePage(count: number): HiveMessagePage {
  const messages: HiveMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    const staffRow = i % 3 === 0;
    messages.push(
      msg({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        createdAt: new Date(Date.UTC(2026, 9, 28, 8, i % 60)).toISOString(),
        body: `Sample message ${i + 1} for scroll and wrap checks.`,
        isMine: staffRow,
        authorRole: staffRow ? "staff" : "client",
        authorDisplayName: staffRow ? "Priya Shah" : "Dana Ellis",
        authorUserId: staffRow ? PRIYA_ID : DANA_ID,
        ...(i === 7
          ? {
              body: "Here is one reply with every cited page from the checking file (cap at six, then +6 more).",
              sourceRefs: Array.from({ length: 12 }, (_, page) => ({
                sourceDocumentId: LONG_REF_DOC,
                pageNumber: page + 1,
                shortLabel: "Checking stmts",
                factId: `long-ref-${page + 1}`,
              })),
            }
          : {}),
      }),
    );
  }
  return {
    ...GALLERY_PEOPLE_PAGE,
    messages,
    nextCursor:
      count > 6
        ? {
            beforeCreatedAt: messages[messages.length - 1]?.createdAt ?? "",
            beforeId: messages[messages.length - 1]?.id ?? "",
          }
        : null,
  };
}

export const GALLERY_HIVE: Hive = {
  id: GALLERY_HIVE_ID,
  hiveId: GALLERY_HIVE_ID,
  name: "Mom's Medicaid application",
  description: "Five-year financial review for a Medicaid application",
  kind: "client",
  clientRequestId: "550e8400-e29b-41d4-a716-446655440001",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
  isOwner: false,
  membershipRole: "professional",
  firmId: "f0000000-0000-4000-8000-000000000099",
  assigneeUserId: PRIYA_ID,
  assigneeDisplayName: "Priya Shah",
  stage: "open",
};

export const GALLERY_EVIDENCE_LABELS = new Map<string, string>([
  ["doc-checking", "Checking statements"],
  ["doc-savings", "Savings statements"],
]);

export const GALLERY_EVIDENCE_CHIP_LABELS = new Map<string, string>([
  ["doc-checking", "Checking stmts"],
  ["doc-savings", "Savings stmts"],
]);