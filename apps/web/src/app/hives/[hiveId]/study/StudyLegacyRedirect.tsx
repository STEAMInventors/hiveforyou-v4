"use client";

import { hiveHomeShowPath, mapStudyLegacyHash } from "@/lib/hive-routes";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function joinTarget(target: string, queryString: string): string {
  if (!queryString) return target;
  const hashIndex = target.indexOf("#");
  const hash = hashIndex >= 0 ? target.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const [path, existing] = withoutHash.split("?");
  const merged = new URLSearchParams(existing ?? "");
  const extra = new URLSearchParams(queryString);
  for (const [key, value] of extra.entries()) {
    if (merged.has(key)) continue;
    merged.append(key, value);
  }
  const qs = merged.toString();
  const base = qs ? `${path}?${qs}` : path;
  return `${base}${hash}`;
}

export function StudyLegacyRedirect({ hiveId, queryString }: { hiveId: string; queryString: string }) {
  const router = useRouter();

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    const target = mapStudyLegacyHash(hiveId, hash);
    router.replace(joinTarget(target, queryString));
  }, [hiveId, queryString, router]);

  return null;
}
