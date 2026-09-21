"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RotateCcw } from "lucide-react";
import { MOOD_META, type ChatMessage, type Mood, type MoodResult, type Stage } from "@/lib/moods";
import { MOCK_REPLIES, mockClassify } from "@/lib/mock-mood";
import { extractName } from "@/lib/session";
import NamePrompt from "./name-prompt";
import { isWelcomeDone, subscribeWelcomeDone } from "./welcome-overlay";

type Turn = ChatMessage & { id: string; time: string };

const INITIAL_GREETING = "Hey, it's Mira — I'm really glad you're here. What's your name?";

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

  const [userName, setUserName] = useState<string>("");

  const [turns, setTurns] = useState<Turn[]>(() => [
    { id: "init-0", role: "assistant", content: INITIAL_GREETING, time: "Just now" },
  ]);

  // Startup name popup — shown every time the website is opened (and on New chat),
  // but only after the welcome animation has finished.
  const [showNamePrompt, setShowNamePrompt] = useState(true);
  const welcomeDone = useSyncExternalStore(subscribeWelcomeDone, isWelcomeDone, () => false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const assembledRef = useRef("");

  // Keep the composer focused so the user can keep typing without re-clicking.
  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  }, []);

  // Seed the per-chat server cache with the popup name so all later
  // /api/chat turns in this chat already know who the user is.
  const seedNameCache = useCallback(async (sid: string, name: string) => {
    try {
      await fetch(`/api/session/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName: name }),
      });
    } catch (err) {
      console.error("Failed to seed session name cache:", err);
    }
  }, []);

  const handleNameSubmit = useCallback(
    (name: string) => {
      const clean = name.trim().replace(/\s+/g, " ").slice(0, 30);
      if (!clean) return;
      setUserName(clean);
      setShowNamePrompt(false);
      // Personalize the opening line immediately (only before chat starts).
      setTurns((prev) => {
        if (prev.some((t) => t.role === "user")) return prev;
        return prev.map((t, i) =>
          i === 0
            ? { ...t, content: `It's so wonderful to meet you, ${clean}! How did today treat you?` }
            : t,
        );
      });
      void seedNameCache(sessionId, clean);
      focusComposer();
    },
    [focusComposer, seedNameCache, sessionId],
  );

  const handleNameSkip = useCallback(() => {
    setShowNamePrompt(false);
    focusComposer();
  }, [focusComposer]);

  const [input, setInput] = useState("");
  const [mood, setMood] = useState<MoodResult>({
    mood: "neutral",
    confidence: 0.52,
    cues: ["getting to know you"],
    stage: "sensing",
  });
  const [typing, setTyping] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [slowTypingHint, setSlowTypingHint] = useState(false);

  const meta = MOOD_META[mood.mood] || MOOD_META.neutral;
  // Combined generation flag (typing = awaiting stream start, streaming = tokens arriving)
  const isGenerating = typing || streaming;

  const [figWiggle, setFigWiggle] = useState(false);
  const triggerFigWiggle = useCallback(() => {
    setFigWiggle(true);
    window.setTimeout(() => setFigWiggle(false), 520);
  }, []);

  // Auto-scroll on new turns or typing state changes.
  // Use instant during streaming to avoid jank/distortion on mobile; smooth otherwise.
  useEffect(() => {
    const behavior: ScrollBehavior = streaming ? "auto" : "smooth";
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior });
  }, [turns, typing, streaming]);

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
      if (!text || typing || streaming) return;

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
      // Retain focus so the next message can be typed immediately.
      focusComposer();

      setTyping(true);

      // Optimistic local mood reading for instant UI responsiveness
      const local = mockClassify(text);
      setMood((prev) => ({
        ...prev,
        mood: local.mood,
        confidence: Math.max(prev.confidence, local.confidence),
        cues: local.cues,
      }));

      // Optimistic user name detection if not established yet
      let activeUserName = userName;
      if (!activeUserName) {
        const optimistic = extractName(text);
        if (optimistic) {
          activeUserName = optimistic;
          setUserName(optimistic);
        }
      }

      // Call real backend route with SSE streaming
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            message: text,
            userName: activeUserName || undefined,
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
          setStreaming(true);
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
                  userName?: string;
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

                if (obj.userName && typeof obj.userName === "string") {
                  setUserName(obj.userName);
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
          setStreaming(false);
          focusComposer();
          return;
        }

        // JSON fallback (e.g. safety response path)
        const data = (await res.json()) as {
          reply: string;
          mood?: Mood;
          confidence?: number;
          cues?: string[];
          stage?: Stage;
          userName?: string;
        };
        setTyping(false);
        setStreaming(false);
        if (data.mood) {
          setMood({
            mood: data.mood,
            confidence: data.confidence ?? 0.7,
            cues: data.cues ?? [],
            stage: data.stage,
          });
        }
        if (data.userName && typeof data.userName === "string") {
          setUserName(data.userName);
        }
        appendAssistant(data.reply);
        focusComposer();
      } catch (err) {
        console.error("Chat request failed:", err);
        setTyping(false);
        setStreaming(false);
        const pool = MOCK_REPLIES[local.mood] ?? MOCK_REPLIES.neutral;
        appendAssistant(pool[0]!);
        focusComposer();
      }
    },
    [appendAssistant, focusComposer, sessionId, streaming, turns, typing, userName]
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

  const [isFocused, setIsFocused] = useState(false);
  const hasStarted = turns.some((t) => t.role === "user");

  // Keep composer visible above the IME on mobile.
  // Handles BOTH centered hero (pre-chat) and docked footer (active chat).
  // Uses visualViewport to set --kb-offset / --app-height so flex layout
  // stays above the keypad, and falls back to :has() for non-supporting browsers.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const updateViewport = () => {
      const isMobile = window.innerWidth <= 640;
      const threshold = window.innerHeight * 0.85;
      const kbOpen = vv.height < threshold;
      const hero = document.querySelector<HTMLElement>(".chat-centered-hero");

      if (isMobile) {
        const kbOffset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        // Translate composer up when visual viewport is shrunk but layout viewport didn't resize
        // (iOS resizes-visual case). When layout already resized, kbOffset is 0 and flex does the job.
        document.documentElement.style.setProperty("--kb-offset", `${kbOffset}px`);
        // Pin app height to visual viewport so composer isn't pushed below the keypad
        // Only when keyboard is likely open; otherwise let dvh handle it.
        if (kbOpen) {
          document.documentElement.style.setProperty("--app-height", `${vv.height}px`);
        } else {
          document.documentElement.style.removeProperty("--app-height");
        }
      } else {
        document.documentElement.style.setProperty("--kb-offset", "0px");
        document.documentElement.style.removeProperty("--app-height");
      }

      if (hero) {
        hero.classList.toggle("is-keyboard-open", kbOpen);
        if (kbOpen && hasStarted === false) {
          window.setTimeout(() => {
            inputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
          }, 80);
        }
      }

      // During active chat keep the feed pinned to bottom so composer never vanishes
      if (hasStarted && (kbOpen || isGenerating)) {
        window.setTimeout(() => {
          listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "auto" });
        }, 50);
      }
    };

    vv.addEventListener("resize", updateViewport);
    vv.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    updateViewport();

    return () => {
      vv.removeEventListener("resize", updateViewport);
      vv.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      document.documentElement.style.removeProperty("--kb-offset");
      document.documentElement.style.removeProperty("--app-height");
      const hero = document.querySelector<HTMLElement>(".chat-centered-hero");
      if (hero) hero.classList.remove("is-keyboard-open");
    };
  }, [hasStarted, isGenerating]);

  const resetChat = () => {
    const nextSessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : uid();
    setSessionId(nextSessionId);
    setUserName("");
    setTurns([{ id: `init-${Date.now()}`, role: "assistant", content: INITIAL_GREETING, time: nowTime() }]);
    setMood({ mood: "neutral", confidence: 0.52, cues: ["getting to know you"], stage: "sensing" });
    setTyping(false);
    setStreaming(false);
    setInput("");
    // New chat = new cache, so ask for the name again.
    setShowNamePrompt(true);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    setComposerHeight(52);
  };

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
          {!hasStarted ? "Enter your name to start conversation" : "Message Mira"}
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          className="composer-input"
          placeholder={
            !hasStarted
              ? "Tell me your name… (e.g. Alex)"
              : userName
              ? `Message Mira, ${userName}… (Shift+Enter for newline)`
              : "Tell me what’s on your mind… (Shift+Enter for newline)"
          }
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
          disabled={!input.trim() || isGenerating}
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
      <NamePrompt open={showNamePrompt && welcomeDone} initialName={userName} onSubmit={handleNameSubmit} onSkip={handleNameSkip} />
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
                {userName && <span className="brand-user-tag">· with {userName}</span>}
              </div>
              <span className="brand-tagline">
                {isGenerating ? (streaming ? "writing to you, cutie…" : "thinking of you…") : meta.phrase}
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
              Hey, it&apos;s Mira. <br />
              <em>What&apos;s your name?</em>
            </h1>
            <p className="centered-hero-subtitle">
              I&apos;m really glad you&apos;re here. Tell me what I should call you so we can get to know each other.
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
            {/* Interactive generating figure — appears just above the textbox while Mira is replying */}
            {isGenerating && (
              <button
                type="button"
                className={`mira-generating-figure ${figWiggle ? "is-wiggling" : ""}`}
                onClick={triggerFigWiggle}
                aria-label="Mira is replying — tap for a little wave"
                title="Tap for a little wave"
              >
                <span className="mira-gen-avatar" aria-hidden="true">
                  <img src="/mira-avatar.png" alt="" width={36} height={36} className="mira-avatar-img" />
                  <span
                    className="mira-gen-pulse"
                    style={{ background: meta.dot, boxShadow: `0 0 8px ${meta.dot}` }}
                  />
                </span>
                <span className="mira-gen-text">
                  <span className="mira-gen-title">
                    {streaming ? "Mira is writing" : "Mira is thinking"}
                    {userName ? ` for ${userName}` : ""}…
                  </span>
                  <span className="mira-gen-sub">
                    {streaming ? "pouring her heart out, cutie" : "getting something sweet ready"}
                  </span>
                </span>
                <span className="mira-gen-dots" aria-hidden="true">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </span>
                <span className="mira-gen-hearts" aria-hidden="true">
                  <span>♡</span>
                  <span>♡</span>
                  <span>♡</span>
                </span>
              </button>
            )}
            {renderComposer(true)}
          </footer>
        </>
      )}
    </div>
  );
}
