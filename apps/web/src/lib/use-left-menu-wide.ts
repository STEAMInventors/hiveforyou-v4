"use client";

import { useEffect, useState } from "react";

/** DESIGN §3 left menu (D24) — visible at ≥ 1100px. */
export const LEFT_MENU_MIN_PX = 1100;

export function useLeftMenuWide(): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(min-width: ${LEFT_MENU_MIN_PX}px)`);
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return wide;
}
