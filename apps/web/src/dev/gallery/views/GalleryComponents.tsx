"use client";

import { Button } from "@/components/ui/Button";
import { Composer } from "@/components/ui/Composer";
import { GlanceRow } from "@/components/ui/GlanceRow";
import { MetaDot, MetaLine } from "@/components/ui/MetaLine";
import { PageHead } from "@/components/ui/PageHead";
import { Section } from "@/components/ui/Section";
import { Segmented } from "@/components/ui/Segmented";
import { StatusDot } from "@/components/ui/StatusDot";
import { Tabs } from "@/components/ui/Tabs";
import { useState } from "react";

import { GalleryFrame } from "./GalleryFrame";

export function GalleryComponents() {
  const [tab, setTab] = useState<"a" | "b">("a");
  const [seg, setSeg] = useState<"all" | "missing">("all");
  return (
    <GalleryFrame title="components">
      <PageHead title="Component gallery" description="Shared UI building blocks from DESIGN.md §3." />
      <Section title="Actions">
        <div className="flex flex-wrap gap-2 py-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="text">Text</Button>
        </div>
      </Section>
      <Section title="Status">
        <div className="flex flex-wrap gap-4 py-3">
          <StatusDot state="needs" />
          <StatusDot state="missing" />
          <StatusDot state="changed" />
          <StatusDot state="checked" />
        </div>
      </Section>
      <Section title="Meta & glance">
        <MetaLine>
          Study v3, accepted Oct 28
          <MetaDot />
          9 documents
          <MetaDot />
          8 to review
        </MetaLine>
        <GlanceRow
          entries={[
            { id: "1", label: "Documents", value: "9", sub: "2 to review" },
            { id: "2", label: "Open items", value: "8", sub: "Across findings" },
          ]}
        />
      </Section>
      <Section title="Tabs & segmented">
        <Tabs options={[{ id: "a", label: "Conversation" }, { id: "b", label: "Ask Sarah" }]} value={tab} onChange={setTab} ariaLabel="Demo" />
        <div className="mt-3">
          <Segmented
            ariaLabel="Filter"
            options={[
              { id: "all", label: "All", count: 19 },
              { id: "missing", label: "Missing", count: 9 },
            ]}
            value={seg}
            onChange={setSeg}
          />
        </div>
      </Section>
      <Section title="Composer">
        <Composer
          textareaId="gallery-draft"
          textareaLabel="Message"
          primaryLabel="Send"
          onPrimary={() => undefined}
          hint="Gallery fixture — not wired to an API."
          textareaProps={{ defaultValue: "", readOnly: true }}
        />
      </Section>
    </GalleryFrame>
  );
}