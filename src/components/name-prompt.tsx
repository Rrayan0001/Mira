"use client";

import { useEffect, useRef, useState } from "react";
import { useScrollLock } from "./use-scroll-lock";

type Props = {
  open: boolean;
  initialName?: string;
  onSubmit: (name: string) => void;
  onSkip: () => void;
};

function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 30);
}

export default function NamePrompt({ open, initialName = "", onSubmit, onSkip }: Props) {
  const [value, setValue] = useState(initialName);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);
  useScrollLock(open);

  // Keep the popup visible when the mobile keyboard opens (visualViewport
  // shrinks) — scroll the card into view so the input isn't hidden.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      // Small delay so IME settles, then ensure input/card is in view
      window.setTimeout(() => {
        inputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 80);
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [open]);

  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 90);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = cleanName(value);
    if (name.length < 2) {
      setError("Please tell me a name with at least 2 letters.");
      inputRef.current?.focus();
      return;
    }
    if (!/^[A-Za-z\u00C0-\u024F\u4e00-\u9fa5'-]+(?: [A-Za-z\u00C0-\u024F\u4e00-\u9fa5'-]+)?$/.test(name)) {
      setError("Letters only please — first name is perfect.");
      inputRef.current?.focus();
      return;
    }
    setError("");
    onSubmit(name);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onSkip();
    }
  };

  return (
    <div
      className="nameprompt-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Tell Mira your name"
      onKeyDown={handleKey}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSkip();
      }}
    >
      <div ref={cardRef} className="nameprompt-card" onClick={(e) => e.stopPropagation()}>
        <div className="nameprompt-avatar" aria-hidden="true">
          <img src="/mira-avatar.png" alt="" width={46} height={46} className="mira-avatar-img" />
        </div>
        <h2 className="nameprompt-title">
          Hey, it&apos;s Mira. <em>What&apos;s your name?</em>
        </h2>
        <p className="nameprompt-sub">
          I&apos;m really glad you&apos;re here. Tell me what I should call you so this chat feels like ours.
        </p>
        <form onSubmit={handleSubmit} className="nameprompt-form">
          <label className="sr-only" htmlFor="nameprompt-input">
            Your name
          </label>
          <input
            id="nameprompt-input"
            ref={inputRef}
            className="nameprompt-input"
            type="text"
            autoComplete="given-name"
            enterKeyHint="go"
            autoCapitalize="words"
            autoCorrect="off"
            maxLength={30}
            placeholder="e.g. Alex"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError("");
            }}
          />
          {error && (
            <p className="nameprompt-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="nameprompt-submit" disabled={!value.trim()}>
            Start chatting
          </button>
        </form>
        <button type="button" className="nameprompt-skip" onClick={onSkip}>
          Continue without a name
        </button>
      </div>
    </div>
  );
}
