import { describe, expect, it } from "vitest";

import {
  legacySavedReportTimelineEmpty,
  legacySavedReportTimelineNotice,
  studyAvailability,
  timelineOlderStudyIdleLine,
} from "./study-availability";

describe("studyAvailability", () => {
  it("marks investigation revisions as older even when a report view exists", () => {
    expect(
      studyAvailability({
        revision: { revisionNumber: 6, format: "investigation-1" },
        hasCanonicalView: false,
        studyLoadError: null,
      }),
    ).toEqual({ kind: "older", revisionNumber: 6 });
  });

  it("requires canonical format and tab view for canonical kind", () => {
    expect(
      studyAvailability({
        revision: { revisionNumber: 8, format: "canonical-study-1" },
        hasCanonicalView: true,
        studyLoadError: null,
      }),
    ).toEqual({ kind: "canonical" });
  });
});

describe("legacy timeline copy", () => {
  it("names the saved revision in the legacy notice", () => {
    expect(legacySavedReportTimelineNotice(6)).toContain("Study v6");
    expect(legacySavedReportTimelineEmpty(6)).toContain("Study v6");
  });

  it("identifies an earlier historical report with audience, title, and saved date", () => {
    const notice = legacySavedReportTimelineNotice(6, {
      reportId: "11111111-1111-4111-8111-111111111111",
      studyRevisionId: "66666666-6666-4666-8666-666666666666",
      revisionNumber: 6,
      audience: "PRO",
      title: "Maya Advocate Brief",
      createdAt: "2026-11-02T14:30:00.000Z",
      fromHistory: true,
    });
    expect(notice).toContain("earlier saved Study v6 Pro report");
    expect(notice).toContain("Maya Advocate Brief");
    expect(notice).toContain("Nov 2, 2026");
    expect(notice).toContain("canonical study");
  });

  it("identifies a latest saved Pro report when not loaded from history", () => {
    const notice = legacySavedReportTimelineNotice(6, {
      reportId: "22222222-2222-4222-8222-222222222222",
      studyRevisionId: "66666666-6666-4666-8666-666666666666",
      revisionNumber: 6,
      audience: "PRO",
      title: "Maya Pro Brief",
      createdAt: "2026-11-03T00:00:00.000Z",
      fromHistory: false,
    });
    expect(notice).toContain("saved Study v6 Pro report");
    expect(notice).not.toContain("earlier saved");
    expect(notice).toContain("Maya Pro Brief");
    expect(notice).toContain("Nov 3, 2026");
  });

  it("does not mention a team on a personal owner hive", () => {
    const line = timelineOlderStudyIdleLine({
      staffView: false,
      viewerIsClient: false,
      staffDisplayName: null,
    });
    expect(line.toLowerCase()).not.toContain("team");
    expect(line).toContain("earlier version");
  });

  it("keeps the client firm line when staff is assigned", () => {
    expect(
      timelineOlderStudyIdleLine({
        staffView: false,
        viewerIsClient: true,
        staffDisplayName: "Priya Shah",
      }),
    ).toContain("Priya's team");
  });
});