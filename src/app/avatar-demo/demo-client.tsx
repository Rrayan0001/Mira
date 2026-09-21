"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  AVATAR_CONFIG,
  Avatar,
  MOOD_REACTIONS,
  type FaustStateName,
} from "@/lib/faust-avatar-player";
import { MOODS } from "@/lib/moods";

const STATE_KEYS = Object.keys(AVATAR_CONFIG.states) as FaustStateName[];

/**
 * DEV-ONLY avatar test page (see companion-avatar-guide.md section 8).
 * Not linked from the site; production builds render 404 (see page.tsx).
 */
export default function AvatarDemoClient() {
  const lightRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const playersRef = useRef<Avatar[]>([]);
  const [width, setWidth] = useState(176);
  const [showGrid, setShowGrid] = useState(false);
  const [log, setLog] = useState("ready — pick a state");

  useEffect(() => {
    const players = [lightRef.current, darkRef.current]
      .filter((el): el is HTMLDivElement => !!el)
      .map((el) => new Avatar(el));
    playersRef.current = players;
    void Promise.all(players.map((p) => p.ready)).then(() => {
      players.forEach((p) => p.play("wave", { then: "idle", holdMs: 300 }));
      setLog("sheet loaded — greeted with wave → idle");
    });
    return () => {
      players.forEach((p) => p.destroy());
      playersRef.current = [];
    };
  }, []);

  const playAll = (name: FaustStateName) => {
    playersRef.current.forEach((p) => p.play(name, { then: "idle", holdMs: 800, once: true }));
    setLog(`played ${name} → idle`);
  };

  const playMood = (mood: (typeof MOODS)[number]) => {
    const r = MOOD_REACTIONS[mood];
    playersRef.current.forEach((p) =>
      r ? p.play(r.state, { then: "idle", holdMs: r.holdMs, once: true }) : p.play("idle"),
    );
    setLog(r ? `mood ${mood} → ${r.state} → idle` : `mood ${mood} → idle (no reaction)`);
  };

  const toggleAttentive = (on: boolean) => {
    playersRef.current.forEach((p) => p.setAttentive(on));
    setLog(`attentive ${on ? "on (lean)" : "off"}`);
  };

  const stageStyle = { "--faust-w": `${width}px` } as CSSProperties;

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif", color: "#0a0a0a", background: "#fff", minHeight: "100dvh" }}>
      <style>{`
        .demo-panels { display: flex; gap: 16px; flex-wrap: wrap; }
        .demo-panel { flex: 1 1 280px; border: 3px solid #0a0a0a; padding: 12px; }
        .demo-panel.dark { background: #141414; color: #fff; }
        .demo-btns { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0; }
        .demo-btns button { border: 2px solid #0a0a0a; background: #fff; padding: 8px 12px; font-weight: 800; cursor: pointer; }
        .demo-btns button:active { transform: translate(2px, 2px); }
        .demo-gridwrap { position: relative; width: min(480px, 100%); margin-top: 16px; border: 3px solid #0a0a0a; }
        .demo-gridwrap img { display: block; width: 100%; height: auto; }
        .demo-gridoverlay { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(9, 1fr); }
        .demo-gridoverlay span { border: 1px solid rgba(255, 46, 136, 0.9); color: #ff2e88; font-size: 9px; font-weight: 800; padding: 1px 2px; background: rgba(255,255,255,0.55); }
      `}</style>

      <p>
        <Link href="/" style={{ fontWeight: 800 }}>← back to chat</Link>
      </p>
      <h1>Faust avatar demo (dev only)</h1>
      <p>
        Reduced-motion check: turn on the OS “reduce motion” setting and reload —
        every state must freeze to one still frame with no continuous animation.
      </p>

      <div className="demo-btns" role="toolbar" aria-label="Avatar states">
        {STATE_KEYS.map((k) => (
          <button key={k} type="button" onClick={() => playAll(k)}>
            {k}
          </button>
        ))}
        <button type="button" onClick={() => toggleAttentive(true)}>attentive on</button>
        <button type="button" onClick={() => toggleAttentive(false)}>attentive off</button>
      </div>

      <div className="demo-btns" role="toolbar" aria-label="Mood reactions">
        {MOODS.map((m) => (
          <button key={m} type="button" onClick={() => playMood(m)}>
            {m}
          </button>
        ))}
      </div>

      <p role="status">log: {log}</p>

      <label style={{ display: "block", margin: "12px 0", fontWeight: 700 }}>
        avatar width: {width}px{" "}
        <input
          type="range"
          min={96}
          max={240}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
        />
      </label>

      <div className="demo-panels">
        <section className="demo-panel" aria-label="Light panel">
          <strong>light panel</strong>
          <div style={stageStyle}>
            <label htmlFor="demo-dummy" style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>
              Dummy textbox, top edge tucked under her feet — click her lower
              third and focus must land in it (clicks pass through):
            </label>
            <div className="faust-stage" aria-hidden="true">
              <div ref={lightRef} className="faust-avatar" data-state="idle" />
            </div>
            <textarea
              id="demo-dummy"
              rows={2}
              style={{
                width: "100%",
                border: "2px solid #0a0a0a",
                marginTop: "calc(var(--faust-w) * -0.13)",
                paddingTop: "calc(var(--faust-w) * 0.15)",
              }}
              placeholder="click the avatar — I should focus"
            />
          </div>
        </section>
        <section className="demo-panel dark" aria-label="Dark panel">
          <strong>dark panel (check the dotted foot ring)</strong>
          <div className="faust-stage" aria-hidden="true" style={stageStyle}>
            <div ref={darkRef} className="faust-avatar" data-state="idle" />
          </div>
        </section>
      </div>

      <div style={{ marginTop: 20 }}>
        <button
          type="button"
          onClick={() => setShowGrid((v) => !v)}
          style={{ border: "2px solid #0a0a0a", background: "#fff", padding: "8px 12px", fontWeight: 800, cursor: "pointer" }}
        >
          {showGrid ? "hide raw sheet grid" : "show raw sheet grid (8×9)"}
        </button>
        {showGrid && (
          <div className="demo-gridwrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/avatar/spritesheet.webp" alt="Raw Faust spritesheet" />
            <div className="demo-gridoverlay" aria-hidden="true">
              {Array.from({ length: 9 }, (_, r) =>
                Array.from({ length: 8 }, (_, c) => (
                  <span key={`${r},${c}`}>{r},{c}</span>
                )),
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
