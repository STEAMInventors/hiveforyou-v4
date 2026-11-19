import { AppShell } from "@/components/app-header";
import { HivePageHead } from "@/components/workspace/HivePageHead";
import { WorkspaceChromeProvider } from "@/components/workspace/workspace-context";

import { GalleryFrame } from "./GalleryFrame";

export function GalleryShell() {
  return (
    <GalleryFrame title="shell">
      <WorkspaceChromeProvider>
        <AppShell account={{ initials: "JL", displayName: "Jordan Lee", email: "jordan@example.com", startingView: "clients" }}>
          <div className="flex min-h-[480px] bg-canvas">
            <aside className="hidden w-rail shrink-0 border-r border-line bg-canvas p-3 min-[900px]:block">
              <p className="m-0 text-label font-semibold text-ink">Sample client hive</p>
              <p className="m-0 mt-1 text-label text-ink-3">Bank statements review</p>
            </aside>
            <div className="flex-1 bg-paper px-4 py-6 min-[900px]:px-10">
              <HivePageHead title="Hive board" subtitle="Prototype shell chrome fixture." />
              <p className="m-0 text-body text-ink-2">Content column uses the workspace frame.</p>
            </div>
          </div>
        </AppShell>
      </WorkspaceChromeProvider>
    </GalleryFrame>
  );
}