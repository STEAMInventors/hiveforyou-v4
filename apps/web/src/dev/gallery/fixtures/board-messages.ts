import type { HiveMessage, HiveMessagePage } from "@hiveforyou/contracts";

const HIVE = "11111111-1111-4111-8111-111111111111";

function msg(partial: Partial<HiveMessage> & Pick<HiveMessage, "id" | "body" | "createdAt">): HiveMessage {
  return {
    authorKind: "person",
    authorRole: "client",
    authorUserId: "c0000000-0000-4000-8000-000000000001",
    authorDisplayName: "Elena Vasquez",
    authorRoleLabel: "Client",
    isMine: false,
    sourceRefs: [],
    replyToMessageId: null,
    handoffFromMessageId: null,
    triggerMessageId: null,
    ...partial,
  };
}

export const GALLERY_PEOPLE_PAGE: HiveMessagePage = {
  messages: [
    msg({
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-10-28T14:05:00.000Z",
      authorRole: "staff",
      authorUserId: "d0000000-0000-4000-8000-000000000002",
      authorDisplayName: "Jordan Lee",
      authorRoleLabel: "Onboarding associate",
      isMine: true,
      body: "Welcome. Upload the statements when you can and we'll track what's still open.",
    }),
    msg({
      id: "00000000-0000-4000-8000-000000000002",
      createdAt: "2026-10-28T14:12:00.000Z",
      body: "I added the bank PDFs. Are we missing any months?",
    }),
    msg({
      id: "00000000-0000-4000-8000-000000000003",
      createdAt: "2026-10-28T14:13:00.000Z",
      authorKind: "assistant",
      authorRole: "assistant",
      authorUserId: null,
      authorDisplayName: "Sarah",
      authorRoleLabel: "",
      body: "April, May and June 2023 are not in the uploaded checking statements.",
      sourceRefs: [
        { sourceDocumentId: "doc-checking", pageNumber: 2, shortLabel: "Checking stmts", factId: "f1" },
      ],
    }),
  ],
  participantRoleLabels: ["Client", "Onboarding associate"],
  participantCount: 2,
  viewerLastReadAt: null,
  nextCursor: null,
};

export function longMessagePage(count: number): HiveMessagePage {
  const messages: HiveMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    messages.push(
      msg({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        createdAt: new Date(Date.UTC(2026, 9, 28, 8, i % 60)).toISOString(),
        body: `Sample message ${i + 1} for scroll and wrap checks.`,
        isMine: i % 3 === 0,
        authorRole: i % 3 === 0 ? "staff" : "client",
        authorDisplayName: i % 3 === 0 ? "Jordan Lee" : "Elena Vasquez",
      }),
    );
  }
  return {
    ...GALLERY_PEOPLE_PAGE,
    messages,
    nextCursor:
      count > 6
        ? { beforeCreatedAt: messages[messages.length - 1]?.createdAt ?? "", beforeId: messages[messages.length - 1]?.id ?? "" }
        : null,
  };
}

export const GALLERY_HIVE_ID = HIVE;