"use client";

import { hiveFactsPath, mapStudyLegacyHash } from "@/lib/hive-routes";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function StudyLegacyRedirect({ hiveId, queryString }: { hiveId: string; queryString: string }) {
  const router = useRouter();

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    const target = hash ? mapStudyLegacyHash(hiveId, hash) : hiveFactsPath(hiveId);
    const suffix = queryString ? `?${queryString}` : "";
    router.replace(`${target}${suffix}`);
  }, [hiveId, queryString, router]);

  return null;
}