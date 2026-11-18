"use client";

import { hiveFindingsPath, mapStudyLegacyHash } from "@/lib/hive-routes";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function joinTarget(target: string, queryString: string): string {
  if (!queryString) return target;
  const [path, existing] = target.split("?");
  const merged = new URLSearchParams(existing ?? "");
  const extra = new URLSearchParams(queryString);
  for (const [key, value] of extra.entries()) {
    if (merged.has(key)) continue;
    merged.append(key, value);
  }
  const qs = merged.toString();
  return qs ? `${path}?${qs}` : path;
}

export function StudyLegacyRedirect({ hiveId, queryString }: { hiveId: string; queryString: string }) {
  const router = useRouter();

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    const target = hash ? mapStudyLegacyHash(hiveId, hash) : hiveFindingsPath(hiveId);
    router.replace(joinTarget(target, queryString));
  }, [hiveId, queryString, router]);

  return null;
}
