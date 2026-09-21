"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useScrollLock } from "./use-scroll-lock";

const SEEN_KEY = "mira-welcome-seen";
const SHOW_MS = 1900;
const EXIT_MS = 550;

export default function WelcomeOverlay() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leftRef = useRef(false);
  const skipRef = useRef<HTMLButtonElement>(null);
  useScrollLock(visible);

  const dismiss = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    setLeaving(true);
    window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>("main, #chat-main, .chat-app").forEach((el) => (el.inert = false));
      const stay = new URLSearchParams(window.location.search).get("welcome") === "stay";
      if (!stay) {
        try {
          sessionStorage.setItem(SEEN_KEY, "1");
        } catch {}
      }
      setVisible(false);
    }, EXIT_MS);
  }, []);

  useEffect(() => {
    const stay = new URLSearchParams(window.location.search).get("welcome") === "stay";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!stay) {
      try {
        if (sessionStorage.getItem(SEEN_KEY) === "1") return;
      } catch {}
    }
    const frame = requestAnimationFrame(() => {
      setVisible(true);
      skipRef.current?.focus({ preventScroll: true });
    });
    const background = Array.from(document.querySelectorAll<HTMLElement>("main, #chat-main, .chat-app"));
    const previous = background.map((el) => el.inert);
    background.forEach((el) => (el.inert = true));
    const auto = stay ? 0 : window.setTimeout(dismiss, SHOW_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(auto);
      background.forEach((el, i) => (el.inert = previous[i]));
      document.removeEventListener("keydown", onKey);
    };
  }, [dismiss]);

  if (!visible) return null;

  return (
    <div className={`welcome ${leaving ? "welcome-leaving" : ""}`} role="dialog" aria-modal="true" aria-label="Welcome to Mira">
      <div className="welcome-inner">
        <div className="welcome-doodle-wrap" aria-hidden="true">
          <img
            src="/mira-doodle-transparent.png"
            alt=""
            className="welcome-doodle-img"
            width={160}
            height={175}
          />
        </div>
        <p className="welcome-word">mira</p>
        <p className="welcome-sub">TUNING INTO YOU</p>
        <p className="welcome-tag">Tell me everything. I am listening.</p>
        <div className="welcome-loader" aria-hidden="true">
          <span />
        </div>
        <p className="welcome-hint">READING THE ROOM, SOFTLY</p>
      </div>
      <button ref={skipRef} className="welcome-skip" onClick={dismiss}>
        Skip intro
      </button>
    </div>
  );
}
