"use client";

import { useEffect } from "react";

import { AppShell } from "@/components/app-header";
import { ClientsHomeProvider } from "@/lib/hives/clients-home-context";

import { HivesLeftMenu } from "@/components/hives/HivesLeftMenu";

import { GalleryFrame } from "./GalleryFrame";

/** Concept v5 Your hives with `.side-nav [data-queue=mine]` at 1280px. */
export function GalleryHivesFirmMenu() {
  useEffect(() => {
    document.title = "Development gallery — hives-firm-menu";
  }, []);

  const counts = { all: 6, mine: 2, unassigned: 1, own: 1, needs: 2, ready: 3 };

  return (
    <GalleryFrame>
      <ClientsHomeProvider enabled initialQuery="">
        <AppShell
          account={{
            initials: "PS",
            displayName: "Priya Shah",
            email: "priya@example.com",
            startingView: "clients",
          }}
        >
          <div className="hv flex min-h-full flex-1 flex-col bg-canvas min-[1100px]:grid min-[1100px]:grid-cols-[232px_minmax(0,1fr)]">
            <HivesLeftMenu
              firmName="Example Law Group"
              personLine="Priya Shah"
              queue="mine"
              counts={counts}
              showMine
              showUnassigned
              showYourOwn
              searchActive={false}
              onSelectQueue={() => {}}
            />
            <div className="hv-main px-8 py-7">
              <h1 className="m-0 font-brand text-section font-semibold text-ink">Your hives</h1>
              <p className="mt-4 text-body text-ink-2">Hive rows use live list components on /hives.</p>
            </div>
          </div>
        </AppShell>
      </ClientsHomeProvider>
    </GalleryFrame>
  );
}