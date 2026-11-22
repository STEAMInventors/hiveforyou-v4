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