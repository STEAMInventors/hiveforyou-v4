"use client";

import type { FindingsOpenItem, HiveBoardChecklistItem, SourceDocument, StudyViewSources } from "@hiveforyou/contracts";
import { useState } from "react";

import { useEvidenceViewer } from "@/components/study/EvidenceViewer";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Section";
import { ShowFewer, ShowMore } from "@/components/ui/ShowMore";
import { StatusDot } from "@/components/ui/StatusDot";
import { Step } from "@/components/ui/Step";
import { CHECKLIST_ANCHOR_ID } from "@/lib/hive-routes";
import { ChecklistGapAddButton } from "./ChecklistGapAddButton";
import { firstChipForOpenItem, openItemForChecklistGap, stillToComeCount } from "./documents-page-model";

const LIMIT = 5;

type DocumentsStillToComeProps = {
  hiveId: string;
  checklist: readonly HiveBoardChecklistItem[];
  openItems: readonly FindingsOpenItem[];
  sources: StudyViewSources | null;
  documents: readonly SourceDocument[];
  acceptedStudyRevisionId: string | null;
  onDocumentsChange: (documents: SourceDocument[]) => void;
  onAddFiles: () => void;
};

function rowStatus(item: HiveBoardChecklistItem) {
  if (item.status === "in") return <StatusDot state="checked" label="Received" />;
  if (item.status === "added_pending") return <StatusDot state="changed" label="Added" />;
  return <StatusDot state="missing" label="Missing" />;
}

function WhyButton({
  gapId,
  openItems,
  sources,
}: {
  gapId: string;
  openItems: readonly FindingsOpenItem[];
  sources: StudyViewSources | null;
}) {
  const viewer = useEvidenceViewer();
  const item = openItemForChecklistGap(gapId, openItems);
  const chip = item ? firstChipForOpenItem(item, sources) : null;
  if (!item || !chip) return null;
  return (
    <Button
      variant="quiet"
      type="button"
      onClick={(event) => viewer.open(chip, event.currentTarget, { itemId: item.id })}
    >
      Why
    </Button>
  );
}

export function DocumentsStillToCome({
  hiveId,
  checklist,
  openItems,
  sources,
  documents,
  acceptedStudyRevisionId,
  onDocumentsChange,
  onAddFiles,
}: DocumentsStillToComeProps) {
  const [expanded, setExpanded] = useState(false);

  if (checklist.length === 0) return null;

  const openCount = stillToComeCount(checklist);
  const visible = expanded ? checklist : checklist.slice(0, LIMIT);
  const detailFor = (item: HiveBoardChecklistItem) => {
    const linked = openItemForChecklistGap(item.gapId, openItems);
    const why = linked?.question?.trim();
    if (why && why !== item.title.trim()) return why;
    const text = item.statusText.trim();
    return text && text !== "Not in yet." ? text : "";
  };

  return (
    <Section id={CHECKLIST_ANCHOR_ID} title={`Still to come ${openCount}`} className="scroll-mt-4">
      <div data-testid="documents-still-to-come">
      <div>
        {visible.map((item) => (
          <Step
            key={item.gapId}
            status={rowStatus(item)}
            title={item.title}
            detail={detailFor(item) || undefined}
            action={
              <div className="flex flex-wrap items-center justify-end gap-2">
                {item.status === "not_in" ? (
                  <ChecklistGapAddButton
                    hiveId={hiveId}
                    gapId={item.gapId}
                    title={item.title}
                    revisionId={acceptedStudyRevisionId}
                    documents={documents}
                    onDocumentsChange={onDocumentsChange}
                    onAddFiles={onAddFiles}
                  />
                ) : null}
                <WhyButton gapId={item.gapId} openItems={openItems} sources={sources} />
              </div>
            }
          />
        ))}
      </div>
      {checklist.length > LIMIT ? (
        expanded ? (
          <ShowFewer label="Show fewer" onClick={() => setExpanded(false)} />
        ) : (
          <ShowMore label={`Show all ${checklist.length}`} onClick={() => setExpanded(true)} />
        )
      ) : null}
      </div>
    </Section>
  );
}