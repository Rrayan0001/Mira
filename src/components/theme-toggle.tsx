"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./use-theme";

function subscribeNoop(): () => void {
  return () => {};
}

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  // SSR always renders the light (Moon) variant. useSyncExternalStore keeps
  // the client's first render identical (server snapshot = false) and flips
  // to the real theme after hydration — no mismatch for returning dark-mode
  // users, and no setState-in-effect lint issue.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const isDark = mounted && theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle-btn"
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
    >
      {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </button>
  );
}
