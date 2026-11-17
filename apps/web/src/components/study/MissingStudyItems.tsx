"use client";

import type { StudyViewDocumentRequestList, StudyViewRow } from "@hiveforyou/contracts";
import { useMemo } from "react";

import { buildMissingItemRows } from "./build-missing-items";
import type { MissingGroups } from "./missing-groups";
import { MissingItemsCard } from "./MissingItemsCard";
type MissingStudyItemsProps = {
  readonly conflicts: readonly StudyViewRow[];
  readonly missing: MissingGroups;
  readonly documentRequestList: StudyViewDocumentRequestList | null;
  readonly documentDate: (sourceDocumentId: string) => string | null | undefined;
};

export function MissingStudyItems(props: MissingStudyItemsProps) {
  const items = useMemo(
    () =>
      buildMissingItemRows({
        conflicts: props.conflicts,
        missing: props.missing,
        documentRequestList: props.documentRequestList,
        documentDate: props.documentDate,
      }),
    [props.conflicts, props.missing, props.documentRequestList, props.documentDate],
  );

  if (items.length === 0) {
    return (
      <MissingItemsCard
        items={[]}
      />
    );
  }

  return <MissingItemsCard items={items} />;
}