"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { MOOD_META, type ChatMessage, type Mood, type MoodResult, type Stage } from "@/lib/moods";
import { MOCK_REPLIES, mockClassify } from "@/lib/mock-mood";

type Turn = ChatMessage & { id: string; time: string };

const INITIAL_GREETING = "Hey, it's Mira — I'm really glad you're here. How did today treat you?";

function nowTime(): string {
  if (typeof window === "undefined") return "Just now";
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export default function ChatUI() {
  const [sessionId, setSessionId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : uid()
  );

  const [turns, setTurns] = useState<Turn[]>(() => [
    { id: "init-0", role: "assistant", content: INITIAL_GREETING, time: "Just now" },
  ]);

  const [input, setInput] = useState("");
  const [mood, setMood] = useState<MoodResult>({
    mood: "neutral",
    confidence: 0.52,
    cues: ["getting to know you"],
    stage: "sensing",
  });
  const [typing, setTyping] = useState(false);
  const [slowTypingHint, setSlowTypingHint] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const assembledRef = useRef("");

  const meta = MOOD_META[mood.mood] || MOOD_META.neutral;

  // Auto-scroll on new turns or typing state changes
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, typing]);

  // Show gentle hint if generation takes longer than 4.5 seconds
  useEffect(() => {
    if (!typing) return;
    const timer = window.setTimeout(() => {
      setSlowTypingHint(true);
    }, 4500);
    return () => {
      window.clearTimeout(timer);
      setSlowTypingHint(false);
    };
  }, [typing]);

  const appendAssistant = useCallback((text: string) => {
    const newTurn: Turn = {
      id: `turn-${Date.now()}-${uid()}`,
      role: "assistant",
      content: text,
      time: nowTime(),
    };
    setTurns((prev) => [...prev, newTurn]);
  }, []);

  const [composerHeight, setComposerHeight] = useState(52);
  const topFadeRef = useRef<HTMLDivElement>(null);
  const bottomFadeRef = useRef<HTMLDivElement>(null);

  const updateFades = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (topFadeRef.current) {
      topFadeRef.current.style.opacity = Math.min(scrollTop / 16, 1).toString();
    }
    if (bottomFadeRef.current) {
      const bottomScroll = scrollHeight - clientHeight - scrollTop;
      bottomFadeRef.current.style.opacity = Math.min(Math.max(bottomScroll, 0) / 16, 1).toString();
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    e.target.style.height = "auto";
    const newScrollHeight = e.target.scrollHeight;
    const clampedHeight = Math.max(38, Math.min(newScrollHeight, 140));
    e.target.style.height = `${clampedHeight}px`;
    setComposerHeight(clampedHeight + 14);
    setTimeout(updateFades, 0);
  };

  const sendMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || typing) return;

      const userTurn: Turn = {
        id: `turn-${Date.now()}-${uid()}`,
        role: "user",
        content: text,
        time: nowTime(),
      };

      const currentHistory: ChatMessage[] = [...turns, userTurn].map(
        ({ role, content }) => ({ role, content })
      );

      setTurns((prev) => [...prev, userTurn]);
      setInput("");

      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }
      setComposerHeight(52);

      setTyping(true);

      // Optimistic local mood reading for instant UI responsiveness
      const local = mockClassify(text);
      setMood((prev) => ({
        ...prev,
        mood: local.mood,
        confidence: Math.max(prev.confidence, local.confidence),
        cues: local.cues,
      }));

      // Call real backend route with SSE streaming
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            message: text,
            history: currentHistory.slice(0, -1),
          }),
        });

        if (!res.ok) throw new Error(String(res.status));

        const ctype = res.headers.get("content-type") || "";

        if (ctype.includes("text/event-stream")) {
          const reader = res.body?.getReader();
          if (!reader) throw new Error("no stream");

          const decoder = new TextDecoder();
          assembledRef.current = "";
          let buffer = "";

          const assistantTurnId = `turn-${Date.now()}-${uid()}`;
          setTyping(false);
          setTurns((prev) => [
            ...prev,
            { id: assistantTurnId, role: "assistant", content: "", time: nowTime() },
          ]);

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let idx: number;

            while ((idx = buffer.indexOf("\n\n")) !== -1) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);

              if (!chunk.startsWith("data: ")) continue;
              const json = chunk.slice(6);

              try {
                const obj = JSON.parse(json) as {
                  token?: string;
                  done?: boolean;
                  mood?: Mood;
                  confidence?: number;
                  cues?: string[];
                  stage?: Stage;
                  error?: string;
                };

                // Update mood and stage metadata as soon as it arrives
                if (obj.mood) {
                  setMood({
                    mood: obj.mood,
                    confidence: obj.confidence ?? 0.8,
                    cues: obj.cues ?? [],
                    stage: obj.stage,
                  });
                }

                if (obj.token) {
                  assembledRef.current += obj.token;
                  const fullText = assembledRef.current;
                  setTurns((prev) =>
                    prev.map((tr) => (tr.id === assistantTurnId ? { ...tr, content: fullText } : tr))
                  );
                }

                if (obj.error) {
                  assembledRef.current += "\n\n(" + obj.error + ")";
                  const fullText = assembledRef.current;
                  setTurns((prev) =>
                    prev.map((tr) => (tr.id === assistantTurnId ? { ...tr, content: fullText } : tr))
                  );
                }
              } catch {}
            }
          }

          if (!assembledRef.current) {
            const pool = MOCK_REPLIES[local.mood] ?? MOCK_REPLIES.neutral;
            appendAssistant(pool[0]!);
          }
          return;
        }

        // JSON fallback (e.g. safety response path)
        const data = (await res.json()) as {
          reply: string;
          mood?: Mood;
          confidence?: number;
          cues?: string[];
          stage?: Stage;
        };

        setTyping(false);
        if (data.mood) {
          setMood({
            mood: data.mood,
            confidence: data.confidence ?? 0.7,
            cues: data.cues ?? [],
            stage: data.stage,
          });
        }
        appendAssistant(data.reply);
      } catch (err) {
        console.error("Chat request failed:", err);
        setTyping(false);
        const pool = MOCK_REPLIES[local.mood] ?? MOCK_REPLIES.neutral;
        appendAssistant(pool[0]!);
      }
    },
    [appendAssistant, sessionId, turns, typing]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const resetChat = () => {
    const nextSessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : uid();
    setSessionId(nextSessionId);
    setTurns([{ id: `init-${Date.now()}`, role: "assistant", content: INITIAL_GREETING, time: nowTime() }]);
    setMood({ mood: "neutral", confidence: 0.52, cues: ["getting to know you"], stage: "sensing" });
    setTyping(false);
    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    setComposerHeight(52);
  };

  const [isFocused, setIsFocused] = useState(false);
  const hasStarted = turns.some((t) => t.role === "user");

  const renderComposer = (isDocked: boolean) => (
    <div className={`composer-container ${isDocked ? "is-docked" : "is-centered"}`}>
      <form
        className={`composer-form ${isFocused || input.trim() ? "is-expanded" : "is-retracted"}`}
        onSubmit={onSubmit}
        style={{
          minHeight: `${composerHeight}px`,
        }}
      >
        <div ref={topFadeRef} className="composer-fade-top" aria-hidden="true" />

        <label className="sr-only" htmlFor="chat-input">
          Message Mira
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          className="composer-input"
          placeholder="Tell me what’s on your mind… (Shift+Enter for newline)"
          rows={1}
          value={input}
          onChange={handleInputChange}
          onScroll={updateFades}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={onKeyDown}
          maxLength={2000}
        />

        <div ref={bottomFadeRef} className="composer-fade-bottom" aria-hidden="true" />

        <button
          className={`send-button ${input.trim() ? "active" : ""}`}
          type="submit"
          disabled={!input.trim() || typing}
          aria-label="Send message"
        >
          <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
      <p className="composer-footnote">
        Mira is a caring AI companion · Private &amp; supportive · Not for emergency care
      </p>
    </div>
  );

  return (
    <div className="chat-app">
      {/* Top App Bar */}
      <header className="chat-topbar">
        <div className="chat-topbar-inner">
          <div className="brand-section">
            <div className="mira-avatar-header" aria-hidden="true">
              <img src="/mira-avatar.png" alt="Mira" className="mira-avatar-img" width={38} height={38} />
              <span className="pulse-indicator" />
            </div>
            <div className="brand-info">
              <div className="brand-title">
                <span>mira</span>
              </div>
              <span className="brand-tagline">
                {typing ? "listening & thinking…" : meta.phrase}
              </span>
            </div>
          </div>

          <div className="topbar-actions">
            {(turns.length > 1 || mood.mood !== "neutral") && (
              <div
                className="topbar-mood-tag"
                title={`Detected mood: ${mood.mood} (${Math.round(mood.confidence * 100)}% confidence)`}
              >
                <span
                  className="mood-dot-pulse"
                  style={{
                    backgroundColor: meta.dot,
                    boxShadow: `0 0 10px ${meta.dot}`,
                  }}
                  aria-hidden="true"
                />
                <span className="mood-prefix">MOOD:</span>
                <strong className="mood-bold-name" style={{ color: meta.dot }}>
                  {mood.mood.toUpperCase()}
                </strong>
              </div>
            )}
            <button
              type="button"
              className="reset-chat-btn"
              onClick={resetChat}
              title="Start a new conversation"
              aria-label="Start a new conversation"
            >
              <RotateCcw size={13} />
              <span>New chat</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main View: Centered Landing when empty, Active Stream once conversation starts */}
      {!hasStarted ? (
        <div className="chat-centered-hero">
          <div className="centered-hero-inner">
            <div className="centered-avatar-wrap" aria-hidden="true">
              <img
                src="/mira-avatar.png"
                alt="Mira"
                className="centered-avatar-img"
                width={58}
                height={58}
              />
              <span className="pulse-indicator" />
            </div>
            <h1 className="centered-hero-title">
              Tell me everything. <br />
              <em>I am listening.</em>
            </h1>
            <p className="centered-hero-subtitle">
              Warm, caring, and always tuned into how you feel. Take your time and say whatever is on your mind.
            </p>
            <div className="centered-composer-slot">
              {renderComposer(false)}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Message Stream */}
          <div
            ref={listRef}
            className="chat-feed-wrap"
            role="log"
            aria-live="polite"
            aria-label="Conversation with Mira"
          >
            <div className="chat-feed-inner">
              {turns.map((t) => (
                <div key={t.id} className={`bubble-row ${t.role}`}>
                  {t.role === "assistant" && (
                    <div className="bubble-avatar" aria-hidden="true">
                      <img src="/mira-avatar.png" alt="Mira" className="mira-avatar-img" width={32} height={32} />
                    </div>
                  )}
                  <div className="bubble-content-wrap">
                    <div className={`bubble bubble-${t.role}`}>
                      {t.content ? (
                        t.content
                      ) : (
                        <span className="streaming-dots" aria-label="Incoming response">
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                        </span>
                      )}
                    </div>
                    <span className="bubble-meta" suppressHydrationWarning>
                      {t.time}
                    </span>
                  </div>
                </div>
              ))}

              {typing && (
                <div className="bubble-row assistant">
                  <div className="bubble-avatar" aria-hidden="true">
                    <img src="/mira-avatar.png" alt="Mira" className="mira-avatar-img" width={32} height={32} />
                  </div>
                  <div className="bubble-content-wrap">
                    <div className="typing-bubble" aria-label="Mira is typing">
                      <span className="sr-only">Mira is typing…</span>
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                    {slowTypingHint && (
                      <span className="typing-status-hint">Taking a gentle moment to reflect…</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Docked Composer Bar */}
          <footer className="composer-section">
            {renderComposer(true)}
          </footer>
        </>
      )}
    </div>
  );
}
