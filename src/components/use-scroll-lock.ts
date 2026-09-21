"use client";
import { useEffect } from "react";
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    const y = window.scrollY;
    const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
    Object.assign(body.style, { position: "fixed", top: `-${y}px`, width: "100%", overflow: "hidden" });
    return () => {
      Object.assign(body.style, previous);
      window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
    };
  }, [active]);
}
