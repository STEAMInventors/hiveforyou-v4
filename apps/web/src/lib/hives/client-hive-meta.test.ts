import { describe, expect, it } from "vitest";

import { hiveAttention } from "@hiveforyou/contracts";

import { clientHiveMetaLine, clientListIntakeDisplay } from "./client-hive-meta";

const viewer = "11111111-1111-4111-8111-111111111111";

describe("clientHiveMetaLine", () => {
  it("builds firm hive meta with assignee first name", () => {
    const line = clientHiveMetaLine(
      {
        id: "a",
        hiveId: "a",
        name: "Alex",
        kind: "client",
        description: "Benefits application",
        firmId: "f",
        assigneeUserId: "other",
        assigneeDisplayName: "Dana Holmes",
        clientRequestId: "b",
        createdAt: "",
        updatedAt: "",
      },
      viewer,
    );
    expect(line).toBe("Benefits application · Dana on it");
  });

  it("uses em dash intake when nothing has arrived", () => {
    const attention = hiveAttention({
      documentCount: 0,
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
      openChecked: 0,
      hasStudy: false,
      hasReport: false,
    });
    expect(
      clientListIntakeDisplay({ documentCount: 0, intake: { total: 0, received: 0 }, attention, study: null }).text,
    ).toBe("—");
  });
});