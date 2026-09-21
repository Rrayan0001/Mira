"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "mira-theme";
const LIGHT_META = "#ffffff";
const DARK_META = "#0f0f12";

function resolveInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable — fall through to the default */
  }
  // Bright theme is the default, regardless of OS preference.
  return "light";
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
  } else {
    root.removeAttribute("data-theme");
  }
  // Keep the mobile browser chrome in sync with the page.
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", theme === "dark" ? DARK_META : LIGHT_META);
}

/** Current theme + toggle, persisted to localStorage. Bright is the default. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  // Lazy initializer already adopts the pre-paint boot script's data-theme
  // (or falls back to stored choice / OS preference), so no sync effect needed.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window === "undefined"
      ? "light"
      : (document.documentElement.getAttribute("data-theme") as Theme | null) === "dark"
        ? "dark"
        : resolveInitialTheme(),
  );

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}
