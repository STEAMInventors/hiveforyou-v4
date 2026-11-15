import { describe, expect, it } from "vitest";

import { hiveBoardPath, hiveDocumentsPath, hivePath, hiveReportsPath, hiveStudyPath } from "./hive-routes";

const HIVE_ID = "11111111-1111-4111-8111-111111111111";

describe("hive routes", () => {
  it("exposes board as the first tab route", () => {
    expect(hivePath(HIVE_ID)).toBe(`/hives/${HIVE_ID}`);
    expect(hiveBoardPath(HIVE_ID)).toBe(`/hives/${HIVE_ID}/board`);
    expect(hiveDocumentsPath(HIVE_ID)).toBe(`/hives/${HIVE_ID}/documents`);
    expect(hiveStudyPath(HIVE_ID)).toBe(`/hives/${HIVE_ID}/study`);
    expect(hiveReportsPath(HIVE_ID)).toBe(`/hives/${HIVE_ID}/reports`);
  });
});