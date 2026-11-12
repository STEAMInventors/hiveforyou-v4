import {
  buildStudyView,
  buildStudyViewSources,
  CANONICAL_STUDY_SCHEMA,
  type CanonicalStudy,
  type StudyView,
  type StudyViewSources,
} from "@hiveforyou/contracts";

const HIVE_ID = "5a5a5a5a-0000-4000-8000-0000000000aa";

/** Statement-only gap from Maya revision 1: pipeline wording, not a document to upload. */
export const MAYA_REVISION_1_ANCHOR_GAP =
  "No single document organizes all others as an anchor. The spine source is TIMELINE.";

/** Statement-only gap that still names a record, without structured request fields. */
export const MAYA_REVISION_1_PROGRESS_GAP = "January 2026 progress report is not among the uploaded documents.";

/** Canonical study shape saved before gap kind, title, why, and holder existed. */
export const MAYA_REVISION_1_STUDY: CanonicalStudy = {
  schema: CANONICAL_STUDY_SCHEMA,
  domainLabel: "Special education",
  spineSource: "TIMELINE",
  documents: [],
  spine: [],
  outsideSpine: [],
  conflicts: [],
  timeline: [],
  gaps: [
    {
      id: "X1",
      statement: MAYA_REVISION_1_ANCHOR_GAP,
      relatedSpineIds: [],
      kind: null,
      title: "",
      why: "",
      holder: "",
      holderType: null,
      when: null,
      basisType: null,
      relatedFactIds: [],
    },
    {
      id: "X2",
      statement: MAYA_REVISION_1_PROGRESS_GAP,
      relatedSpineIds: [],
      kind: null,
      title: "",
      why: "",
      holder: "",
      holderType: null,
      when: null,
      basisType: null,
      relatedFactIds: [],
    },
    {
      id: "X3",
      statement: "A page could not be read, so that page is not part of the study.",
      relatedSpineIds: [],
      kind: null,
      title: "",
      why: "",
      holder: "",
      holderType: null,
      when: null,
      basisType: null,
      relatedFactIds: [],
    },
  ],
};

export type MayaRevision1Fixture = {
  readonly hiveId: string;
  readonly study: CanonicalStudy;
  readonly view: StudyView;
  readonly sources: StudyViewSources;
};

export function mayaRevision1Fixture(): MayaRevision1Fixture {
  const { view } = buildStudyView(MAYA_REVISION_1_STUDY, { sections: [], blocks: [] }, [], {});
  return {
    hiveId: HIVE_ID,
    study: MAYA_REVISION_1_STUDY,
    view,
    sources: buildStudyViewSources(view, [], new Map()),
  };
}
