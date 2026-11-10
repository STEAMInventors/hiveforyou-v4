import {
  buildStudyView,
  buildStudyViewSources,
  CANONICAL_STUDY_SCHEMA,
  type CanonicalStudy,
  type StudyView,
  type StudyViewSources,
} from "@hiveforyou/contracts";

const HIVE_ID = "8badf00d-0000-4000-8000-000000000099";

/** Canonicalize output before structured document-request gap fields (statement-only gaps). */
const LEGACY_STUDY: CanonicalStudy = {
  schema: CANONICAL_STUDY_SCHEMA,
  domainLabel: "Household records",
  spineSource: null,
  documents: [],
  spine: [],
  outsideSpine: [],
  conflicts: [],
  timeline: [],
  gaps: [
    {
      id: "X1",
      statement: "Water bill for March 2026 is not among the uploaded documents.",
      relatedSpineIds: [],
      kind: null,
      title: "",
      why: "",
      holder: "",
      when: null,
      basisType: null,
      relatedFactIds: [],
    },
    {
      id: "X2",
      statement: "Lease addendum referenced in the intake form was not supplied.",
      relatedSpineIds: [],
      kind: null,
      title: "",
      why: "",
      holder: "",
      when: null,
      basisType: null,
      relatedFactIds: [],
    },
  ],
};

export type LegacyGapsFixture = {
  readonly hiveId: string;
  readonly view: StudyView;
  readonly sources: StudyViewSources;
};

export function legacyCanonicalGapsFixture(): LegacyGapsFixture {
  const { view } = buildStudyView(LEGACY_STUDY, { sections: [], blocks: [] }, [], {});
  return {
    hiveId: HIVE_ID,
    view,
    sources: buildStudyViewSources(view, [], new Map()),
  };
}
